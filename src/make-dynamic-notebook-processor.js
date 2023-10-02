/* global Opal */
const child_process = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

module.exports.register = function register(registry) {
    const logger = Opal.Asciidoctor.LoggerManager.getLogger();

    registry.treeProcessor(function () {
        const self = this;
        self.process(function (doc) {
            const blocks = doc.findBy({ context: 'listing', style: 'source' })
                .filter((b) => b.getAttribute('language') === 'makefile' && b.isOption('dynamic'));
            doc.findBy({ context: 'listing', style: 'source' }).filter((b) => console.log("language attr: ", b.getAttribute('language'), " ", b.isOption('dynamic')));
            if (blocks && blocks.length > 0) {
                for (const block of blocks) {
                    try {
                        console.log("[makefile] Extracted Attributes:", block.getAttributes());

                        const adocbasefname = path.parse(doc.getAttribute('docfile')).name;
                        const parent = block.getParent()
                        const parentBlocks = parent.getBlocks()
                        const blockIndex = parentBlocks['$find_index'](block) + 1
                        const code = block.getSource();

                        // Use filename from attribute or fallback to a timestamped name
                        const filename = block.getAttribute('filename', `Makefile`);
                        let cppDirPath = path.join('cpp', adocbasefname);
                        const tmpFilePath = path.join(cppDirPath, filename);
                        fs.mkdirSync(cppDirPath, { recursive: true });
                        console.log(`[makefile] Writing Makefile to ${tmpFilePath}`);
                        fs.writeFileSync(tmpFilePath, code);
                    } catch (err) {
                        logger.error(`[makefile] Error processing Makefile block: ${err.message}`);
                    }
                }
            }
            return doc;
        });
    });
}
