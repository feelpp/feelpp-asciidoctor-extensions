/* global Opal */
const { compile } = require('handlebars');
const child_process = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const argSetsDelimiter = ';'; // Delimiter for multiple argument sets

class CompilationError extends Error {
    constructor(message) {
        super(message);
        this.name = "CompilationError";
    }
}

function wrapCode(code, filename) {
    if (filename.startsWith('snippet_')) {
        return `#include <iostream>
#include <string>
#include <string_view>
#include <cassert>

int main()
{
   ${code}
}`;
    }
    return code;
}

function escapeAsciidoc(input) {
    const replacements = {
        '*': '\\*',
        '_': '\\_',
        '#': '\\#',
        '<': '&lt;',
        '>': '&gt;',
        // ... add other characters as needed
    };
    return input.replace(/[*_#<>]/g, match => replacements[match] || match);
}


function setup(block, adocbasefname) {
    // console.log("Extracted Attributes:", block.getAttributes());
    const attribute = block.getAttribute('language');
    const code = block.getSource();

    // Use filename from attribute or fallback to a timestamped name
    const filename = block.getAttribute('filename', `tmp_${Date.now()}.${attribute}`);
    let sourceDirPath = path.join('cpp', adocbasefname);
    fs.mkdirSync(sourceDirPath, { recursive: true });
    const tmpFilePath = path.join(sourceDirPath, filename);
    let exeFilename = '';
    let languageName = '';
    if (attribute === 'cpp') {
        exeFilename = filename.replace(/\.cpp$/, '.exe');
        languageName = "C++";
    }
    else if (attribute === 'c') {
        exeFilename = filename.replace(/\.c$/, '.exe');
        languageName = "C";
    }
    else {
        throw new Error(`Unsupported language: ${attribute}`);
    }
    const execFilenameTmp = block.getAttribute('exec', '');
    if (execFilenameTmp) {
        exeFilename = execFilenameTmp;
    }
    const blockCommand = block.getAttribute('compile', 'make');
    let build_dir = '';
    if (blockCommand === 'cmake') {
        build_dir = block.getAttribute('build', 'build');
    }

    const tmpExePath = path.join(sourceDirPath, build_dir, exeFilename);
    console.log(`Writing ${languageName} code to ${tmpFilePath}`);
    const wrappedCode = wrapCode(code, filename);
    fs.writeFileSync(tmpFilePath, wrappedCode);

    return [sourceDirPath, tmpFilePath, languageName, tmpExePath, build_dir]
}


function compileCPP(sourceDirPath, compilArgs, baseSourceFilePath, baseExePath) {
    let compileCommand = `g++ ${compilArgs} ${baseSourceFilePath} -o ${baseExePath}`;

    let compileResult = child_process.spawnSync('g++', [compilArgs, baseSourceFilePath, '-o', baseExePath], { cwd: sourceDirPath, shell: true });
    if (compileResult.error || compileResult.status !== 0) {
        throw new CompilationError(["[sh] compilation error: >>", compileResult.stderr.toString(), "<< ", sourceDirPath, " ", baseExePath ]);
    }

    return [compileCommand, compileResult.stdout.toString('utf8')];
}


function compileC(sourceDirPath, compilArgs, baseSourceFilePath, baseExePath) {
    let compileCommand = `gcc ${compilArgs} ${baseSourceFilePath} -o ${baseExePath}`;

    let compileResult = child_process.spawnSync('gcc', [compilArgs, baseSourceFilePath, '-o', baseExePath], { cwd: sourceDirPath, shell: true });
    if (compileResult.error || compileResult.status !== 0) {
        throw new CompilationError(["[sh] compilation error: >>", compileResult.stderr.toString(), "<< ", sourceDirPath, " ", baseExePath ]);
    }

    return [compileCommand, compileResult.stdout.toString('utf8')];
}

function compileMake(sourceDirPath, baseExePath) {
    let compileCommand = `make ${baseExePath}`;
    console.log(`[make] compileCommand: ${compileCommand}`);

    let compileResult = child_process.spawnSync('make', [baseExePath], { cwd: sourceDirPath, shell: true });
    if (compileResult.error || compileResult.status !== 0) {
        throw new CompilationError(["[make] compilation error: ",  sourceDirPath, " ", baseExePath ]);
    }
    return [compileCommand, compileResult.stdout.toString('utf8')];

}

function compileMPI(sourceDirPath, baseSourceFilePath, baseExePath) {
    let compileCommand = `mpicxx ${baseSourceFilePath} -o ${baseExePath}`;

    let compileResult = child_process.spawnSync('mpicxx', [baseSourceFilePath, '-o', baseExePath], { cwd: sourceDirPath, shell: true });
    if (compileResult.error || compileResult.status !== 0) {
        throw new CompilationError(["[mpi] compilation error: ", compileResult.error, compileResult.stderr.toString(), " ", sourceDirPath, " ", baseExePath ]);
    }
    return [compileCommand, compileResult.stdout.toString('utf8')];
}

function setupCMake(sourceDirPath, buildDir)
{
    console.log("Setting up CMake");

    let configureCommand = `cmake -B ${buildDir} .`;
    let compileCommand = `cmake --build ${buildDir}`;

    let configureResult = child_process.spawnSync('cmake', ['-B', buildDir, '.'], { cwd: sourceDirPath, shell: true });
    if (configureResult.error || configureResult.status !== 0) {
        throw new CompilationError(["[cmake] configure error: ", configureResult.error, configureResult.stderr.toString(), " ", sourceDirPath, " ", buildDir ]);
    }

    let compileResult = child_process.spawnSync('cmake', ['--build', buildDir], { cwd: sourceDirPath, shell: true });
    if (compileResult.error || compileResult.status !== 0) {
        throw new CompilationError(["[cmake] compilation error: ", compileResult.error, compileResult.stderr.toString(), " ", sourceDirPath, " ", buildDir ]);
    }

    return [`${configureCommand}\n${compileCommand}`, configureResult.stdout.toString('utf8')];
}

function compileCode(blockCommand, compilArgs, sourceDirPath, filePath, exePath, buildDir) {
    let baseSourceFilePath = path.basename(filePath);
    let baseExePath = path.basename(exePath);


    let compileCommand = '';
    let compileResultStdout = '';

    if (blockCommand === 'sh' || blockCommand === 'cpp' || blockCommand === 'openmp') {
        if (blockCommand === 'openmp') {
            compilArgs += ' -fopenmp';
        }
        [compileCommand, compileResultStdout] = compileCPP(sourceDirPath, compilArgs, baseSourceFilePath, baseExePath);
    }
    else if (blockCommand === 'c') {
        [compileCommand, compileResultStdout] = compileC(sourceDirPath, compilArgs, baseSourceFilePath, baseExePath);
    }
    else if (blockCommand === 'mpi') {
        [compileCommand, compileResultStdout] = compileMPI(sourceDirPath, baseSourceFilePath, baseExePath);
    }
    else if (blockCommand === 'make') {
        [compileCommand, compileResultStdout] = compileMake(sourceDirPath, baseExePath);
    }
    else if (blockCommand === 'cmake') {
        [compileCommand, compileResultStdout] = setupCMake(sourceDirPath, buildDir);
    }

    return [compileCommand, compileResultStdout];
}


function embedCompilationCommand(self, block, compileCommand, compileResultStdout){
    let compileDisplayLine = compileCommand.split('\n').map(line => `$ ${line}`).join('\n');
    // console.log(`compileDisplayLine: ${compileDisplayLine}`);
    const compileExampleBlock = self.createExampleBlock(block, '', [], { 'content_model': 'compound', 'context': 'sidecar examp' })
    compileExampleBlock.setTitle('Compilation Command Line')
    const compileBlock = self.createLiteralBlock(block, compileDisplayLine, { role: 'compile-command' });
    compileExampleBlock.append(compileBlock);

    if ( compileResultStdout ) {
        const opts = Object.fromEntries(Object.entries(block.getAttributes()).filter(([key, _]) => key.endsWith('-option')))
        // Embed result in document
        const attrs = {
            ...opts,
            'style': 'source',
            'language': 'sh',
            'collapsible-option': ''
        };
        if (block.isOption('open')) {
            attrs['folded-option'] = '';

        }

        const compileResultBlock = self.createExampleBlock(block, '', attrs, { 'content_model': 'compound' })
        compileResultBlock.setTitle('Results')
        compileResultBlock.append(self.createLiteralBlock(compileResultBlock, compileResultStdout, { role: 'dynamic-cpp-result' }));
        compileExampleBlock.append(compileResultBlock);
    }

    return compileExampleBlock;
}


function embedExecutionResult(self, block, blockCommand, filePath, exePath, buildDir){
    let baseExePath = path.basename(exePath);

    // Extract inputs from the 'inputs' attribute
    const blockInputs = block.getAttribute('inputs', '').replace(/\\n/g, '\n');
    // Extract options from the 'opts' attribute
    let argSets = block.getAttribute('args', '').split(argSetsDelimiter).map(s => s.trim());
    for (const args of argSets) {

        // Extract options from the 'opts' attribute
        let exeOptions = args.split(/\s+/);

        // console.log(`exeOptions: ${exeOptions}`);

        // Execute compiled code
        if (!fs.existsSync(exePath)) {
            throw new Error(`Expected compiled executable not found at: ${exePath}`);
        }
        //let executionResult = child_process.spawnSync(tmpExePath);

        let execPrefix = '';
        if (blockCommand === 'mpi') {
            let np = block.getAttribute('np', '2');
            execPrefix = `mpirun -np ${np} `;
        }

        if (buildDir === '') {
            buildDir = '.';
        }

        let executionCmdLine = `${execPrefix}${buildDir}/${baseExePath}`
        let executionResult = child_process.spawnSync(executionCmdLine, exeOptions, {
            cwd: path.dirname(filePath),
            shell: true,
            input: blockInputs // pass the inputs to the executed program
        });
        if (executionResult.error) {
            throw new Error( ["execution error", executionResult.error] );
        }

        let executionDisplayLine = `$ ${executionCmdLine} ${args}`;
        if (blockInputs) {
            executionDisplayLine += `\n${blockInputs}`;
        }
        const execExampleBlock = self.createExampleBlock(block, '', [], { 'content_model': 'compound', 'context': 'sidecar' })
        execExampleBlock.setTitle('Execution Command Line')
        if (args) {
            execExampleBlock.setTitle(`Execution Command Line with arguments \`${args}\``)
        }
        const executionCmdBlock = self.createLiteralBlock(block, executionDisplayLine, { role: 'execution-command' });
        execExampleBlock.append(executionCmdBlock);


        const opts = Object.fromEntries(Object.entries(block.getAttributes()).filter(([key, _]) => key.endsWith('-option')))
        // Embed result in document
        const attrs = {
            ...opts,
            'style': 'source',
            'language': 'sh',
            'collapsible-option': ''
        };
        if (block.isOption('open')) {
            attrs['folded-option'] = '';

        }

        let stdoutContent = escapeAsciidoc(executionResult.stdout.toString('utf8'));
        console.log(`stdoutContent: ${stdoutContent}`);
        let stderrContent = escapeAsciidoc(executionResult.stderr.toString('utf8'));

        const exampleBlock = self.createExampleBlock(block, '', attrs, { 'content_model': 'compound' })
        //const exampleBlock = self.createExampleBlock(block, executionResult.stdout.toString('utf8'), [], attrs);
        exampleBlock.setTitle('Results')
        if ( args ) {
            exampleBlock.setTitle(`Results`)
        }
        exampleBlock.append(self.createLiteralBlock(exampleBlock, stdoutContent, { role: 'dynamic-cpp-result' }));

        if (stderrContent) {
            const stderrBlock = self.createLiteralBlock(exampleBlock, stderrContent, { role: 'dynamic-cpp-result-error' });
            exampleBlock.append(stderrBlock);
        }
        execExampleBlock.append(exampleBlock);

        return execExampleBlock;
    } // for loop on argset
}



module.exports.register = function register(registry) {
    const logger = Opal.Asciidoctor.LoggerManager.getLogger();

    registry.treeProcessor(function () {
        const self = this;
        self.process(function (doc) {
            const blocks = doc.findBy({ context: 'listing', style: 'source' })
                .filter((b) => (b.getAttribute('language') === 'cpp' || b.getAttribute('language') === 'c') && b.isOption('dynamic'));

            if (blocks && blocks.length > 0) {
                for (const block of blocks) {
                    const adocbasefname = path.parse( doc.getAttribute('docfile') ).name;
                    const parent = block.getParent()
                    const parentBlocks = parent.getBlocks()
                    const blockIndex = parentBlocks['$find_index'](block) + 1

                    let [sourceDirPath, tmpFilePath, languageName, tmpExePath, buildDir] = setup(block, adocbasefname);
                    console.log(`[cpp-dynamic-processor] Found ${languageName} block`);

                    // try {

                        // Compile C++ code
                        const blockCommand = block.getAttribute('compile', 'make');
                        const compilArgs = block.getAttribute('comp-args', '-std=c++17');

                        // console.log(`[cpp-dynamic-processor] blockCommand: ${blockCommand}`);
                        if (!['sh', 'cpp', 'c', 'make', 'mpi', 'openmp', 'cmake'].includes(blockCommand)) {
                            continue;
                        }
                        let [compileCommand, compileResultStdout] = compileCode(blockCommand, compilArgs, sourceDirPath, tmpFilePath, tmpExePath, buildDir);

                        // Embed Compilation Command and result in document
                        let compileExampleBlock = embedCompilationCommand(self, block, compileCommand, compileResultStdout);
                        parentBlocks.splice(blockIndex, 0, compileExampleBlock);


                        const blockRun = block.getAttribute('run', 'true')
                        if (blockRun === 'false') {
                            continue;
                        }

                        // console.log(`[cpp-dynamic-processor] tmpExePath: ${tmpExePath}`);

                        // Embed execution result in document
                        let execExampleBlock = embedExecutionResult(self, block, blockCommand, tmpFilePath, tmpExePath, buildDir);
                        parentBlocks.splice(blockIndex + 1, 0, execExampleBlock);


                        // Clean up temporary files
                        //fs.unlinkSync(tmpFilePath);
                        //fs.unlinkSync(tmpExePath);

                    // } catch (err) {
                    //     logger.error(`Error processing ${languageName} block: ${err.message}`);
                    //     process.exit(1);
                    // }
                }
            }
            return doc;
        });
    });
}
