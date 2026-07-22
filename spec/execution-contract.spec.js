/* global describe it */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const chai = require('chai')
const expect = chai.expect

const dynamicNotebookExt = require('../src/dynamic-notebook-processor.js')
const asciidoctor = require('@asciidoctor/core')()

const fixtureDir = path.join(__dirname, 'fixtures', 'dynamic-python')
const contentCatalog = {
  resolveResource: () => null
}
const file = { src: 'contract.adoc' }

function convertFixture (name) {
  const registry = asciidoctor.Extensions.create()
  dynamicNotebookExt.register(registry, { contentCatalog, file })
  return asciidoctor.convertFile(path.join(fixtureDir, name), {
    extension_registry: registry,
    safe: 'safe',
    standalone: true,
    to_file: false
  })
}

function captureError (callback) {
  try {
    callback()
  } catch (error) {
    return error
  }
  throw new Error('Expected callback to throw')
}

function isolatedTemporaryDirectories () {
  return fs.readdirSync(os.tmpdir())
    .filter((entry) => entry.startsWith('feelpp-asciidoc-python-'))
    .sort()
}

describe('Executable Python contract fixtures', () => {
  it('preserves deterministic shared state within one page', () => {
    const html = convertFixture('success.adoc')
    expect(html).to.contain('value=42')
    expect(html).to.contain('shared-state=ok')
  })

  it('turns an explicitly strict Python error into a build failure', () => {
    const error = captureError(() => convertFixture('strict-error.adoc'))
    expect(error.code).to.equal('block-execution-failed')
    expect(error.message).to.contain('intentional contract failure')
    expect(error.details.blockId).to.equal('required-failure')
  })

  it('stops execution at the configured page timeout and removes its temporary workspace', () => {
    const before = isolatedTemporaryDirectories()
    const error = captureError(() => convertFixture('timeout.adoc'))
    expect(error.code).to.equal('execution-timeout')
    expect(error.details.timeoutSeconds).to.equal(1)
    expect(isolatedTemporaryDirectories()).to.deep.equal(before)
  })

  it('rejects aggregate output beyond the configured byte limit', () => {
    const error = captureError(() => convertFixture('oversized-output.adoc'))
    expect(error.code).to.equal('output-limit-exceeded')
    expect(error.details.maximumOutputBytes).to.equal(1024)
  })

  it('uses the configured interpreter and reports a structured missing-interpreter error', () => {
    const registry = asciidoctor.Extensions.create()
    dynamicNotebookExt.register(registry, { contentCatalog, file })
    const source = `:dynamic-blocks:\n:dynamic-python-interpreter: /definitely/missing/python\n\n[%dynamic,python]\n----\nprint("unreachable")\n----`

    const error = captureError(() => asciidoctor.convert(source, { extension_registry: registry }))
    expect(error.code).to.equal('interpreter-not-found')
    expect(error.details.interpreter).to.equal('/definitely/missing/python')
  })

  it('does not inherit arbitrary credentials and cleans the isolated temporary directory', () => {
    const previous = process.env.FEELPP_TEST_SECRET
    process.env.FEELPP_TEST_SECRET = 'must-not-reach-python'
    let html
    try {
      html = convertFixture('isolation.adoc')
    } finally {
      if (previous === undefined) delete process.env.FEELPP_TEST_SECRET
      else process.env.FEELPP_TEST_SECRET = previous
    }

    expect(html).to.contain('secret-visible=False')
    const match = html.match(/isolated-temporary-directory=([^<\n]+)/)
    expect(match).not.to.equal(null)
    expect(fs.existsSync(match[1])).to.equal(false)
  })

  it('embeds deterministic Matplotlib output with accessible text', () => {
    const first = convertFixture('rich-output.adoc')
    const second = convertFixture('rich-output.adoc')

    expect(first).to.equal(second)
    expect(first).to.contain('dynamic-py-result-matplotlib')
    expect(first).to.contain('src="data:image/png;base64,')
    expect(first).to.contain('alt="A labelled deterministic line"')
    expect(first).to.contain('<figcaption>A two-point deterministic example</figcaption>')
    expect(first).to.contain('slope=1')
  })

  it('rejects Matplotlib output without alternative text', () => {
    const registry = asciidoctor.Extensions.create()
    dynamicNotebookExt.register(registry, { contentCatalog, file })
    const source = `:dynamic-blocks:\n\n[%dynamic,python,output=matplotlib]\n----\nimport matplotlib.pyplot as plt\nplt.plot([0, 1])\n----`

    expect(() => asciidoctor.convert(source, { extension_registry: registry })).to.throw(
      'Matplotlib output requires a non-empty figure-alt attribute'
    )
  })

  it('inventories implemented safety and rich-output requirements', () => {
    const contract = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'contract.json'), 'utf8'))
    const requirements = new Map(contract.requirements.map((item) => [item.id, item]))

    expect(requirements.get('page-timeout').importance).to.equal('P0')
    expect(requirements.get('page-timeout').expected).to.equal('implemented')
    expect(requirements.get('aggregate-output-limit').importance).to.equal('P0')
    expect(requirements.get('aggregate-output-limit').expected).to.equal('implemented')
    expect(requirements.get('isolated-environment').expected).to.equal('implemented')
    expect(requirements.get('matplotlib-mime-output').importance).to.equal('P1')
    expect(requirements.get('matplotlib-mime-output').expected).to.equal('implemented-png')
    for (const requirement of contract.requirements) {
      expect(fs.existsSync(path.join(fixtureDir, requirement.fixture))).to.equal(true)
    }
  })
})
