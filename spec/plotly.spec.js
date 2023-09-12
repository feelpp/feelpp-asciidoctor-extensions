/* global describe it */
const chai = require('chai')
const expect = chai.expect

const plotlyExt = require('../src/plotly-block-extension.js')
const asciidoctor = require('@asciidoctor/core')()

describe('Plotly', () => {
  describe('When extension is registered', () => {
    it('should create a plot using Plotly', () => {
      const input = `
[plotly#test-1.foo,https://girder.math.unistra.fr/api/v1/file/5afea86fb0e957402704804a/download]
....
// global d
const times = d.map(i => i['T'])
const data = [{
  name: 'IC2 reference results of test 1a',
  type: 'scatter',
  x: times,
  y: d.map(i => i['Ref-test1a-s1']),
  showlegend: true,
  line: { color: '#FF99BB' }
},{
  name: 'IC2 example results of test 1a',
  type: 'scatter',
  x: times,
  y: d.map(i => i['Results-test1a-s1']),
  showlegend: true,
  line: { color: '#CC3333' }
},{
  name: 'Output reference results of test 1a',
  type: 'scatter',
  x: times,
  y: d.map(i => i['Ref-test1a-s2']),
  showlegend: true,
  line: { color: '#BB99FF' }
},{
  name: 'Output example results of test 1a',
  type: 'scatter',
  x: times,
  y: d.map(i => i['Results-test1a-s2']),
  showlegend: true,
  line: { color: '#3333CC' }
}]

const layout = {
  title: 'Temperature'
}
....
`
      const registry = asciidoctor.Extensions.create()
      plotlyExt.register(registry)
      const doc = asciidoctor.load(input, {extension_registry: registry})
      const html = doc.convert()
      expect(html).to.equal(`<div id="test-1"></div>
<script>
  d3.csv("https://girder.math.unistra.fr/api/v1/file/5afea86fb0e957402704804a/download")
    .then((d) => {
      // global d
const times = d.map(i => i['T'])
const data = [{
  name: 'IC2 reference results of test 1a',
  type: 'scatter',
  x: times,
  y: d.map(i => i['Ref-test1a-s1']),
  showlegend: true,
  line: { color: '#FF99BB' }
},{
  name: 'IC2 example results of test 1a',
  type: 'scatter',
  x: times,
  y: d.map(i => i['Results-test1a-s1']),
  showlegend: true,
  line: { color: '#CC3333' }
},{
  name: 'Output reference results of test 1a',
  type: 'scatter',
  x: times,
  y: d.map(i => i['Ref-test1a-s2']),
  showlegend: true,
  line: { color: '#BB99FF' }
},{
  name: 'Output example results of test 1a',
  type: 'scatter',
  x: times,
  y: d.map(i => i['Results-test1a-s2']),
  showlegend: true,
  line: { color: '#3333CC' }
}]

const layout = {
  title: 'Temperature'
}

      Plotly.newPlot('test-1', data, layout, { showLink: false, responsive: true })
    })
    .catch((err) => {
      console.log('Unable to get data', err)
    })
</script>`)
    })
  })
})
