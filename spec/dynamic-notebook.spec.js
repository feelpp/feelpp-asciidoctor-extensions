/* global describe it */
const fsp = require('node:fs/promises')
const ospath = require('node:path')
const chai = require('chai')
const expect = chai.expect

const dynamicNotebookExt = require('../src/dynamic-notebook-processor.js')
const asciidoctor = require('@asciidoctor/core')()

describe('Dynamic Notebook', () => {
  describe('When extension is registered', () => {
    it('should execute code using Python', () => {
      const input = `
:dynamic-blocks:

[%dynamic%open,python]
----
print('hello')
----
`
      const registry = asciidoctor.Extensions.create()
      dynamicNotebookExt.register(registry)
      const doc = asciidoctor.load(input, { extension_registry: registry })
      const html = doc.convert()
      expect(html).to.equal(`<div class="listingblock">
<div class="content">
<pre class="highlight"><code class="language-python" data-lang="python">print('hello')</code></pre>
</div>
</div>
<details open>
<summary class="title">Results</summary>
<div class="content">
<div class="literalblock dynamic-py-result">
<div class="content">
<pre>hello</pre>
</div>
</div>
</div>
</details>`)
    })
    it('should fail on error when fail-on-error attribute is defined', () => {
      const input = `
:dynamic-blocks:

[%dynamic%open,python,fail-on-error=]
----
invalid_python
----
`
      const registry = asciidoctor.Extensions.create()
      dynamicNotebookExt.register(registry)
      try {
        const doc = asciidoctor.load(input, { extension_registry: registry })
        expect.fail('Should throw an error when fail-on-error attribute is define')
      } catch (err) {
        // OK
      }
    })
    it('should ignore error when fail-on-error attribute is not defined', () => {
      const input = `
:dynamic-blocks:

[%dynamic%open,python]
----
invalid_python
----
`
      const registry = asciidoctor.Extensions.create()
      dynamicNotebookExt.register(registry)
      const doc = asciidoctor.load(input, { extension_registry: registry })
      const html = doc.convert()
      expect(html).to.equal(`<div class="listingblock">
<div class="content">
<pre class="highlight"><code class="language-python" data-lang="python">invalid_python</code></pre>
</div>
</div>
<details open>
<summary class="title">Results</summary>
<div class="content">
<div class="literalblock dynamic-py-result">
<div class="content">
<pre>---------------------------------------------------------------------------
NameError                                 Traceback (most recent call last)
File <ipython-input-1-79628dfcbf60>:1
----> 1 invalid_python

NameError: name 'invalid_python' is not defined</pre>
</div>
</div>
</div>
</details>`)
    })
    it('should write execution result when :dynamic-blocks-cache-result: is defined', async () => {
      const input = `
:dynamic-blocks:
:dynamic-blocks-cache-result:

[%dynamic,python]
----
print('hello')
----
`
      const registry = asciidoctor.Extensions.create()
      dynamicNotebookExt.register(registry)
      const doc = asciidoctor.load(input, {extension_registry: registry})
      const html = doc.convert()
      expect(html).to.equal(`<div class="listingblock">
<div class="content">
<pre class="highlight"><code class="language-python" data-lang="python">print('hello')</code></pre>
</div>
</div>
<details>
<summary class="title">Results</summary>
<div class="content">
<div class="literalblock dynamic-py-result">
<div class="content">
<pre>hello</pre>
</div>
</div>
</div>
</details>`)
      const executionResultData = await fsp.readFile(ospath.join(__dirname, '..', '.cache', 'e73b48e8e00d36304ea7204a0683c814-0.json'), 'utf8')
      expect(executionResultData).to.equal(`{"success":true,"stderr":"","stdout":"hello\\n","id":"e73b48e8e00d36304ea7204a0683c814-0","code":"print('hello')"}`)
    })
    it('should output more than one Plotly charts', () => {
      const input = `
:dynamic-blocks:

[%dynamic%raw,python]
----
import plotly.express as px

figs = []
figs.append(px.line(px.data.gapminder().query("country=='Canada'"), x="year", y="lifeExp", title='Life expectancy in Canada'))
figs.append(px.line(px.data.gapminder().query("continent=='Oceania'"), x="year", y="lifeExp", color='country'))

for fig in figs:
  fig.show()
----
`
      const registry = asciidoctor.Extensions.create()
      dynamicNotebookExt.register(registry)
      const doc = asciidoctor.load(input, { extension_registry: registry })
      const html = doc.convert()
      expect(html).to.contains(`<div class="listingblock">
<div class="content">
<pre class="highlight"><code class="language-python" data-lang="python">import plotly.express as px

figs = []
figs.append(px.line(px.data.gapminder().query("country=='Canada'"), x="year", y="lifeExp", title='Life expectancy in Canada'))
figs.append(px.line(px.data.gapminder().query("continent=='Oceania'"), x="year", y="lifeExp", color='country'))

for fig in figs:
  fig.show()</code></pre>
</div>
</div>
<details class="dynamic-py-result dynamic-py-result-plotly dynamic-py-result-plotly-grid">
<summary class="title">Results</summary>`)
      const blocksCount = Array.from(html.matchAll(/<div id="[^"]+" class="plotly-graph-div" .*<\/script>/gm), (m) => m[0]).length
      expect(blocksCount).to.eq(2)
    })
  })
})
