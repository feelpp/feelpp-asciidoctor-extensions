/* global Opal */
const child_process = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');


function saveCMakeList(adocbasefname, block, filename) {

    const code = block.getSource();

    // Use filename from attribute or fallback to a timestamped name
    let cppDirPath = path.join('cpp', adocbasefname);
    const tmpFilePath = path.join(cppDirPath, filename);
    fs.mkdirSync(cppDirPath, { recursive: true });
    console.log(`[CMake-processor] Writing Makefile to ${tmpFilePath}`);
    fs.writeFileSync(tmpFilePath, code);
}

module.exports.register = function register(registry) {
    const logger = Opal.Asciidoctor.LoggerManager.getLogger();

    registry.treeProcessor(function () {
        const self = this;
        self.process(function (doc) {
            const blocks = doc.findBy({ context: 'listing', style: 'source' })
                .filter((b) => b.getAttribute('language') === 'cmake' && b.isOption('dynamic'));
            if (blocks && blocks.length > 0) {
                console.log(`[CMake] Found ${blocks.length} cmake blocks`);
                for (const block of blocks) {
                    try {
                        console.log("[CMake] Extracted Attributes:", block.getAttributes());

                        const adocbasefname = path.parse(doc.getAttribute('docfile')).name;
                        const filename = block.getAttribute('filename', `CMakeLists.txt`);
                        // const parent = block.getParent()
                        // const parentBlocks = parent.getBlocks()
                        // const blockIndex = parentBlocks['$find_index'](block) + 1

                        // Save the Makefile to a file
                        saveCMakeList(adocbasefname, block, filename);
                    } catch (err) {
                        logger.error(`[CMake-processor] Error processing CMake block: ${err.message}`);
                    }
                }
            }
            return doc;
        });
    });
}
