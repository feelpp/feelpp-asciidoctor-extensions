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

module.exports.register = function register(registry) {
    const logger = Opal.Asciidoctor.LoggerManager.getLogger();

    registry.treeProcessor(function () {
        const self = this;
        self.process(function (doc) {
            const blocks = doc.findBy({ context: 'listing', style: 'source' })
                .filter((b) => b.getAttribute('language') === 'cpp' && b.isOption('dynamic'));

            if (blocks && blocks.length > 0) {
                for (const block of blocks) {
                    try {
                        console.log("Extracted Attributes:", block.getAttributes());

                        const adocbasefname = path.parse( doc.getAttribute('docfile') ).name;
                        const parent = block.getParent()
                        const parentBlocks = parent.getBlocks()
                        const blockIndex = parentBlocks['$find_index'](block) + 1
                        const code = block.getSource();

                        // Use filename from attribute or fallback to a timestamped name
                        const filename = block.getAttribute('filename', `tmp_${Date.now()}.cpp`);
                        let cppDirPath = path.join('cpp', adocbasefname);
                        fs.mkdirSync(cppDirPath, { recursive: true });
                        const tmpFilePath = path.join(cppDirPath, filename);
                        let exeFilename = filename.replace(/\.cpp$/, '.exe');
                        const tmpExePath = path.join(cppDirPath, `${exeFilename}`);
                        console.log(`Writing C++ code to ${tmpFilePath}`);
                        const wrappedCode = wrapCode(code, filename);
                        fs.writeFileSync(tmpFilePath, wrappedCode);

                        // Compile C++ code
                        const blockCommand = block.getAttribute('compile', 'make');
                        let baseCppFilePath = path.basename(tmpFilePath);
                        let baseExePath = path.basename(tmpExePath);
                        let compileCommand = `g++ -std=c++17 ${baseCppFilePath} -o ${baseExePath}`;
                        if (blockCommand === 'make') {
                            compileCommand = `make ${baseExePath}`;
                        }
                        let compileResultStdout = '';
                        if (blockCommand === 'sh') {
                            let compileResult = child_process.spawnSync('g++', ['-std=c++17',baseCppFilePath, '-o', baseExePath], { cwd: path.dirname(tmpFilePath), shell: true });
                            if (compileResult.error || compileResult.status !== 0) {
                                throw new CompilationError(["[sh] compilation error: ", compileResult.stderr.toString(), " ", path.dirname(tmpFilePath), " ", baseExePath ]);
                            }
                            compileResultStdout = compileResult.stdout.toString('utf8');
                        }
                        else if (blockCommand === 'make') {
                            let compileResult = child_process.spawnSync('make', [baseExePath], { cwd: path.dirname(tmpFilePath), shell: true });
                            if (compileResult.error || compileResult.status !== 0) {
                                throw new CompilationError(["[make] compilation error: ",  path.dirname(tmpFilePath), " ", baseExePath ]);
                            }
                            compileResultStdout = compileResult.stdout.toString('utf8');
                        }

                        // Embed Compilation Command
                        let compileDisplayLine = `$ ${compileCommand}`;
                        const compileExampleBlock = self.createExampleBlock(block, '', [], { 'content_model': 'compound', 'context': 'sidecar examp' })
                        compileExampleBlock.setTitle('Compilation Command Line')
                        const compileBlock = self.createLiteralBlock(block, compileDisplayLine, { role: 'compile-command' });
                        compileExampleBlock.append(compileBlock);
                        

                        console.log(`compileResultStdout: ${compileResultStdout}`);
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
                        parentBlocks.splice(blockIndex, 0, compileExampleBlock);
                        


                        // Extract inputs from the 'inputs' attribute
                        const blockInputs = block.getAttribute('inputs', '').replace(/\\n/g, '\n');
                        // Extract options from the 'opts' attribute
                        let argSets = block.getAttribute('args', '').split(argSetsDelimiter).map(s => s.trim());
                        for (const args of argSets) {

                            // Extract options from the 'opts' attribute
                            let exeOptions = args.split(/\s+/);
                            
                            console.log(`exeOptions: ${exeOptions}`);

                            // Execute compiled code
                            if (!fs.existsSync(path.join(path.dirname(tmpFilePath), baseExePath))) {
                                throw new Error(`Expected compiled executable not found at: ${path.join(path.dirname(tmpFilePath), baseExePath)}`);
                            }
                            //let executionResult = child_process.spawnSync(tmpExePath);
                            let executionCmdLine = `./${baseExePath}`
                            let executionResult = child_process.spawnSync(executionCmdLine, exeOptions, { 
                                cwd: path.dirname(tmpFilePath),
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
                            parentBlocks.splice(blockIndex + 1, 0, execExampleBlock);

                        } // for loop on argset
                        // Clean up temporary files
                        //fs.unlinkSync(tmpFilePath);
                        //fs.unlinkSync(tmpExePath);
                    } catch (err) {
                        logger.error(`Error processing C++ block: ${err.message}`);
                    }
                }
            }
            return doc;
        });
    });
}
