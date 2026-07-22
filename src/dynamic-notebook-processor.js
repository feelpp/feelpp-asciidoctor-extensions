/* global Opal */
const child_process = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const ospath = require('node:path')

//const conumRx = /\s*<i class="conum" data-value="[0-9]+"><\/i><b>[^>]+<\/b>/g
const calloutRx = /\s+<(?:[0-9]+|\.)>/g
const figShowRx = /fig.show\(\)/g
const plotterShowRx = /plotter.show\(\)/g
const pyvistaContainerRx = /^var container = document\.querySelector\('.content'\);$/m
const pyvistaScriptRx = /(?<script><script .*<\/script>)/ms
const pyvistaFaviconRx = /n\.setAttribute\("href","https:\/\/kitware.github.io\/vtk-js\/icon\/favicon-".concat\(t,"x"\).concat\(t,".png"\)\),/
const plotlyPlotRx = /<div id="[^"]+" class="plotly-graph-div" .*<\/script>/gm
const matplotlibPngRx = /^__FEELPP_MATPLOTLIB_PNG__([A-Za-z0-9+/=]+)$/gm
const defaultTimeoutSeconds = 60
const maximumTimeoutSeconds = 600
const defaultMaximumOutputBytes = 5 * 1024 * 1024
const absoluteMaximumOutputBytes = 100 * 1024 * 1024
const isolatedEnvironmentPrefix = 'feelpp-asciidoc-python-'
const environmentPassthroughKeys = [
  'PATH',
  'VIRTUAL_ENV',
  'PYTHONHOME',
  'PYTHONPATH',
  'LD_LIBRARY_PATH',
  'DYLD_LIBRARY_PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SYSTEMROOT',
  'WINDIR',
  'PATHEXT'
]

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const matplotlibCapture = `
import base64 as __feelpp_base64
import io as __feelpp_io
import matplotlib.pyplot as __feelpp_plt

for __feelpp_number in __feelpp_plt.get_fignums():
    __feelpp_figure = __feelpp_plt.figure(__feelpp_number)
    __feelpp_buffer = __feelpp_io.BytesIO()
    __feelpp_figure.savefig(
        __feelpp_buffer,
        format="png",
        dpi=120,
        bbox_inches="tight",
        facecolor="white",
        metadata={"Software": "Feel++ executable AsciiDoc"},
    )
    print("__FEELPP_MATPLOTLIB_PNG__" + __feelpp_base64.b64encode(__feelpp_buffer.getvalue()).decode("ascii"))
    __feelpp_buffer.close()
__feelpp_plt.close("all")
`

const ipythonTemplate = (pyCodes) => {
  return `from IPython.core.interactiveshell import InteractiveShell
from IPython.utils.capture import capture_output
import json
import sys
import hashlib

shell = InteractiveShell()
results = []

shell.run_cell('%colors nocolor')

${pyCodes.map((pyCode, index) => {
    return `
with capture_output() as io${index}:
    r${index} = shell.run_cell(${pyCode})
    md5sum = hashlib.md5(${pyCode}.encode('utf8')).hexdigest()
    results.append({
        'success': r${index}.success,
        'stderr': io${index}.stderr,
        'stdout': io${index}.stdout,
        'id': f"{md5sum}-${index}",
        'code': ${pyCode}
    })

`
  }).join('')}

sys.stderr.write(json.dumps(results))
`
}

class ExecutionError extends Error {
  constructor(code, message, details = {}) {
    if (message === undefined) {
      message = code
      code = 'execution-error'
    }
    super(`[${code}] ${message}`)
    this.name = 'ExecutionError'
    this.code = code
    this.details = details
  }

  toJSON () {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    }
  }
}

const parsePositiveInteger = (doc, attribute, fallback, maximum) => {
  const raw = doc.getAttribute(attribute)
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new ExecutionError(
      'invalid-configuration',
      `${attribute} must be a positive integer no greater than ${maximum}`,
      { attribute, value: raw }
    )
  }
  return value
}

const parseBoolean = (doc, attribute, fallback = false) => {
  const raw = doc.getAttribute(attribute)
  if (raw === undefined) return fallback
  if (raw === '' || raw === true || ['true', 'yes', '1'].includes(String(raw).toLowerCase())) return true
  if (raw === false || ['false', 'no', '0'].includes(String(raw).toLowerCase())) return false
  throw new ExecutionError(
    'invalid-configuration',
    `${attribute} must be true, false, yes, no, 1, or 0`,
    { attribute, value: raw }
  )
}

const createIsolatedEnvironment = (temporaryDirectory, isolateUserSite) => {
  const environment = {}
  for (const key of environmentPassthroughKeys) {
    if (process.env[key] !== undefined) environment[key] = process.env[key]
  }

  const cacheDirectory = ospath.join(temporaryDirectory, 'cache')
  const ipythonDirectory = ospath.join(temporaryDirectory, 'ipython')
  const matplotlibDirectory = ospath.join(temporaryDirectory, 'matplotlib')
  for (const directory of [cacheDirectory, ipythonDirectory, matplotlibDirectory]) {
    fs.mkdirSync(directory, { recursive: true })
  }

  const hostHome = process.env.HOME || temporaryDirectory
  const isolatedEnvironment = {
    ...environment,
    HOME: isolateUserSite ? temporaryDirectory : hostHome,
    XDG_CACHE_HOME: isolateUserSite
      ? cacheDirectory
      : (process.env.XDG_CACHE_HOME || ospath.join(hostHome, '.cache')),
    IPYTHONDIR: isolateUserSite
      ? ipythonDirectory
      : (process.env.IPYTHONDIR || ospath.join(hostHome, '.ipython')),
    MPLCONFIGDIR: isolateUserSite
      ? matplotlibDirectory
      : (process.env.MPLCONFIGDIR || ospath.join(hostHome, '.config', 'matplotlib')),
    MPLBACKEND: 'Agg',
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory
  }
  if (isolateUserSite) isolatedEnvironment.PYTHONNOUSERSITE = '1'
  return isolatedEnvironment
}

const abbreviated = (value, maximumLength = 4000) => {
  const text = String(value || '')
  if (text.length <= maximumLength) return text
  return `${text.slice(0, maximumLength)}\n... diagnostic truncated ...`
}

const executePython = (script, configuration) => {
  const temporaryDirectory = fs.mkdtempSync(ospath.join(os.tmpdir(), isolatedEnvironmentPrefix))
  try {
    const result = child_process.spawnSync(configuration.interpreter, ['-'], {
      shell: false,
      input: script,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: configuration.timeoutSeconds * 1000,
      killSignal: 'SIGKILL',
      maxBuffer: configuration.maximumOutputBytes * 2 + 64 * 1024,
      env: createIsolatedEnvironment(temporaryDirectory, configuration.isolateUserSite)
    })

    if (result.error) {
      if (result.error.code === 'ETIMEDOUT') {
        throw new ExecutionError(
          'execution-timeout',
          `Python execution exceeded ${configuration.timeoutSeconds} seconds`,
          { timeoutSeconds: configuration.timeoutSeconds }
        )
      }
      if (result.error.code === 'ENOBUFS') {
        throw new ExecutionError(
          'output-limit-exceeded',
          `Python execution exceeded the ${configuration.maximumOutputBytes}-byte output limit`,
          { maximumOutputBytes: configuration.maximumOutputBytes }
        )
      }
      if (result.error.code === 'ENOENT') {
        throw new ExecutionError(
          'interpreter-not-found',
          `Python interpreter was not found: ${configuration.interpreter}`,
          { interpreter: configuration.interpreter }
        )
      }
      throw new ExecutionError(
        'execution-spawn-failed',
        `Unable to start Python: ${result.error.message}`,
        { interpreter: configuration.interpreter, errorCode: result.error.code }
      )
    }

    if (result.signal) {
      throw new ExecutionError(
        result.signal === 'SIGKILL' ? 'execution-timeout' : 'execution-signal',
        `Python execution stopped with signal ${result.signal}`,
        { signal: result.signal, timeoutSeconds: configuration.timeoutSeconds }
      )
    }
    if (result.status !== 0) {
      throw new ExecutionError(
        'execution-process-failed',
        `Python exited with status ${result.status}: ${abbreviated(result.stderr)}`,
        { status: result.status, interpreter: configuration.interpreter }
      )
    }

    let response
    try {
      response = JSON.parse(result.stderr)
    } catch (error) {
      throw new ExecutionError(
        'invalid-execution-response',
        `Python returned an invalid execution record: ${abbreviated(result.stderr)}`,
        { parserMessage: error.message }
      )
    }
    if (!Array.isArray(response)) {
      throw new ExecutionError('invalid-execution-response', 'Python execution record must be an array')
    }

    const aggregateOutputBytes = response.reduce((total, item) => {
      return total + Buffer.byteLength(String(item.stdout || '')) + Buffer.byteLength(String(item.stderr || ''))
    }, 0)
    if (aggregateOutputBytes > configuration.maximumOutputBytes) {
      throw new ExecutionError(
        'output-limit-exceeded',
        `Python produced ${aggregateOutputBytes} bytes; the limit is ${configuration.maximumOutputBytes}`,
        { aggregateOutputBytes, maximumOutputBytes: configuration.maximumOutputBytes }
      )
    }
    return response
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

/**
 * Executes Python code blocks that have the "dynamic" option.
 * The code blocks are executed in the order of their definition in the AsciiDoc document.
 *
 * We rely on IPython to execute code blocks, which allow to have access to variables defined in previous blocks.
 *
 * NOTE: Code blocks that generate a Plotly chart must end with `fig.show()`.
 * This statement will be replaced by `fig.write_html(file=sys.stdout, include_plotlyjs=False)`.
 * Please note that, Plotly.js must be available in the HTML page, otherwise the chart won't show.
 *
 * NOTE: Code blocks that generate a PyVista chart must end with `plotter.show()`.
 * This statement will be replaced by `sys.stdout.write(plotter.export_html(None).getvalue())`.
 *
 * PREREQUISITES:
 * - python3 must be in the PATH
 * - https://pypi.org/project/ipython/ must be installed and available in the python3 environment
 * - all required dependencies must be installed and available in the python3 environment (for instance, if you are using pandas, you must install it)
 */
module.exports.register = function register(registry, { contentCatalog, file }) {
  const logger = Opal.Asciidoctor.LoggerManager.getLogger()
  registry.treeProcessor(function () {
    const self = this
    self.process(function (doc) {
      const blocks = doc.findBy({ context: 'listing', style: 'source' })
        .filter((b) => b.getAttribute('language') === 'python' && b.isOption('dynamic'))
      if (blocks && blocks.length > 0 && doc.getAttribute('dynamic-blocks') !== undefined) {
        const interpreter = String(doc.getAttribute('dynamic-python-interpreter') || 'python3').trim()
        if (!interpreter) {
          throw new ExecutionError(
            'invalid-configuration',
            'dynamic-python-interpreter must not be empty'
          )
        }
        const timeoutSeconds = parsePositiveInteger(
          doc,
          'dynamic-blocks-timeout-seconds',
          defaultTimeoutSeconds,
          maximumTimeoutSeconds
        )
        const configuredMaximumOutputBytes = parsePositiveInteger(
          doc,
          'dynamic-blocks-max-output-bytes',
          defaultMaximumOutputBytes,
          absoluteMaximumOutputBytes
        )
        const strict = parseBoolean(doc, 'dynamic-blocks-strict', false)
        const isolateUserSite = parseBoolean(doc, 'dynamic-python-isolate-user-site', false)
        const executionConfiguration = {
          interpreter,
          timeoutSeconds,
          maximumOutputBytes: configuredMaximumOutputBytes,
          isolateUserSite
        }
        const ipython = ipythonTemplate(blocks.map((b) => {
          const attributes = b.getDocument().getAttributes();
          const outputDir = attributes['output-dir'] || 'public'; // fallback if not set
          //console.log(attributes)
          const matplotlibOutput = b.getAttribute('output') === 'matplotlib'
          if (matplotlibOutput && !b.getAttribute('figure-alt')) {
            throw new ExecutionError(
              'missing-figure-alt',
              'Matplotlib output requires a non-empty figure-alt attribute',
              { blockId: b.getId() || null }
            )
          }
          let code = b.getSourceLines().join('\n')
            .replaceAll(calloutRx, '')
          if (matplotlibOutput) {
            code = code
              .replaceAll(/(?:plt|pyplot)\.show\(\)/g, '')
              .replaceAll(figShowRx, '')
              .concat(matplotlibCapture)
          } else {
            code = code
              .replaceAll(figShowRx, `import sys; fig.write_html(file=sys.stdout, include_plotlyjs=False)`)
              .replaceAll(plotterShowRx, `import sys; sys.stdout.write(plotter.export_html(None).getvalue())`)
          }
          code = code
            // Replace attachment$ tokens with the resolved URL
            .replaceAll(/xref:([^[]+)\[\]/g, (match, key) => {
                // For example, assume that the attachment reference is constructed from the attachmentsdir attribute
                const base = attributes.attachmentsdir || '';
                // Build an xref-like reference; adjust the format as needed for your setup
                const resource = contentCatalog.resolveResource(key,file.src, 'attachment', ['attachment']);
                if (resource && resource.pub && resource.pub.url) {
                  const resolvedPath = ospath.join(outputDir, resource.pub.url);
                  logger.info('resolvedPath for ',key,' :', resolvedPath);
                  // Optionally check if the file exists
                  if (!fs.existsSync(resolvedPath)) {
                    logger.warn(`File does not exist at: ${resolvedPath}`);
                  }
                  return resolvedPath;
                }
                return match;
            });
         //console.log(JSON.stringify(code))
          return JSON.stringify(code)
        }))
        logger.info(`Processing dynamic blocks with ${interpreter}...`)
        const response = executePython(ipython, executionConfiguration)
        if (response.length !== blocks.length) {
          throw new ExecutionError(
            'invalid-execution-response',
            `Expected ${blocks.length} execution records but received ${response.length}`,
            { expected: blocks.length, actual: response.length }
          )
        }
        for (const [index, block] of blocks.entries()) {
          try {
            const parent = block.getParent()
            const parentBlocks = parent.getBlocks()
            const blockIndex = parentBlocks['$find_index'](block) + 1
            const opts = Object.fromEntries(Object.entries(block.getAttributes()).filter(([key, _]) => key.endsWith('-option')))
            const attrs = {
              ...opts,
              'collapsible-option': ''
            }
            const exampleBlock = self.createExampleBlock(block, '', attrs, { 'content_model': 'compound' })
            exampleBlock.setTitle('Results')

            //Hide code option (hide only the cell code)
            if (block.isOption('hide_code')) {
              exampleBlock.setTitle('')
              block.addRole('hide')
            }

            // //Open option (automatically open the cell results)
            // if (block.isOption('open')){
            //   exampleBlock.addRole('open')
            // }

            //Hide output option (hide the cell results)
            if (block.isOption('hide_output')) {
              exampleBlock.setTitle('')
              exampleBlock.addRole('hide')
            }

            const result = response[index]
            let cacheResultDir = doc.getAttribute('dynamic-blocks-cache-result')
            if (cacheResultDir !== undefined) {
              if (cacheResultDir === '') {
                cacheResultDir = '.cache'
              }
              if (!fs.existsSync(cacheResultDir)) {
                fs.mkdirSync(cacheResultDir, { recursive: true })
              }
              fs.writeFileSync(ospath.join(cacheResultDir, `${result.id}.json`), JSON.stringify(result), 'utf8')
            }
            let source = result.stdout.toString('utf8')
            if (result.success === false) {
              const blockId = block.getId() || `dynamic-block-${index + 1}`
              if (strict || block.hasAttribute('fail-on-error')) {
                // noinspection ExceptionCaughtLocallyJS
                throw new ExecutionError(
                  'block-execution-failed',
                  `Python block ${blockId} failed: ${abbreviated(`${result.stderr} ${result.stdout}`.trim())}`,
                  { blockId, blockIndex: index, strict }
                )
              } else {
                logger.warn(`Execution is unsuccessful in ${blockId}: ${abbreviated(source)}`)
              }
            }
            if (block.getAttribute('output') === 'matplotlib') {
              const images = Array.from(source.matchAll(matplotlibPngRx), (match) => match[1])
              if (images.length === 0) {
                throw new ExecutionError(
                  'missing-matplotlib-output',
                  'Matplotlib block produced no figure',
                  { blockId: block.getId() || null }
                )
              }
              source = source.replace(matplotlibPngRx, '').trim()
              exampleBlock.addRole('dynamic-py-result')
              exampleBlock.addRole('dynamic-py-result-matplotlib')
              if (images.length > 1) exampleBlock.addRole('dynamic-py-result-matplotlib-grid')
              if (source) {
                exampleBlock.append(self.createLiteralBlock(exampleBlock, source, { role: 'dynamic-py-result-text' }))
              }
              const baseAlt = block.getAttribute('figure-alt')
              const caption = block.getAttribute('figure-caption')
              const figures = images.map((png, imageIndex) => {
                const alt = images.length > 1 ? `${baseAlt} (figure ${imageIndex + 1} of ${images.length})` : baseAlt
                const captionHtml = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
                return `<figure class="dynamic-py-figure"><img src="data:image/png;base64,${png}" alt="${escapeHtml(alt)}">${captionHtml}</figure>`
              })
              exampleBlock.append(self.createPassBlock(exampleBlock, figures.join('\n')))
            // option for raw content (Plotly or PyVista)
            } else if (block.isOption('raw')) {
              if (block.getAttribute('output') === 'pyvista') {
                source = source.replace(pyvistaContainerRx, `var container = document.getElementById('pyvista-${index}')`)
                source = source.replace(pyvistaFaviconRx, '')
                const found = source.match(pyvistaScriptRx)
                if (found) {
                  const script = found.groups['script']
                  exampleBlock.append(self.createPassBlock(exampleBlock, `<div id="pyvista-${index}" style="position: relative; height: 500px; border: 1px solid #cecece;"></div>
<script>
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    // make sure that the canvas will be resized accordingly
    window.dispatchEvent(new Event('resize'))
  }
})
resizeObserver.observe(document.getElementById('pyvista-${index}'))
</script>
${script}`, { role: 'dynamic-py-result' }))
                }
              } else {
                exampleBlock.addRole('dynamic-py-result')
                let content = ''
                const plotlyBlocks = Array.from(source.matchAll(plotlyPlotRx), (m) => m[0])
                if (plotlyBlocks) {
                  exampleBlock.addRole('dynamic-py-result-plotly')
                  if (plotlyBlocks.length > 1) {
                    exampleBlock.addRole('dynamic-py-result-plotly-grid')
                  }
                  content = plotlyBlocks.join('\n')
                } else {
                  content = source
                }
                exampleBlock.append(self.createPassBlock(exampleBlock, content))
              }
            } else {
              exampleBlock.append(self.createLiteralBlock(exampleBlock, source, { role: 'dynamic-py-result' }))
            }
            parentBlocks.splice(blockIndex, 0, exampleBlock)
          } catch (err) {
            if (err instanceof ExecutionError) {
              throw err
            } else {
              const errorMessage = { err }
              errorMessage['$inspect'] = () => err.toString()
              logger.error(errorMessage)
            }
          }
        }
      }
      return doc
    })
  })
}
