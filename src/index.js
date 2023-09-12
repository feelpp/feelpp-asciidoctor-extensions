const { register: registerDynamicNotebookProcessor } = require('./dynamic-notebook-processor.js')
const { register: registerMprirunCommandProcessor } = require('./mpirun-command-processor.js')
const { register: registerPlotlyBlock } = require('./plotly-block-extension.js')
const { register: registerRemoteIncludeProcessor } = require('./remote-include-processor.js')
const { register: registerTabsBlock } = require('./tabs-block-extension.js')
const { register: registerVtkjsBlock } = require('./vtkjs-block-extension.js')


module.exports.register = function register(registry, context) {
  registerDynamicNotebookProcessor(registry, context)
  registerMprirunCommandProcessor(registry, context)
  registerPlotlyBlock(registry, context)
  registerRemoteIncludeProcessor(registry, context)
  registerTabsBlock(registry, context)
  registerVtkjsBlock(registry, context)
}
