/* global describe it */
const fsp = require('node:fs/promises')
const ospath = require('node:path')
const chai = require('chai')
const expect = chai.expect

const dynamicNotebookExt = require('../src/dynamic-notebook-processor.js')
const asciidoctor = require('@asciidoctor/core')()

// Create a stub contentCatalog for tests.
const stubContentCatalog = {
  resolveResource: (key, fileSrc, type, tags) => {
    // For tests that use attachment references, you can simulate a resource.
    // For example, if the key includes "attachment$data", return a fake resource.
    if (key.includes('attachment$data')) {
      return { pub: { url: 'attachment/data/resolved.json' } };
    }
    // Otherwise, return null (or a default value) if no resource should be resolved.
    return null;
  }
};

// Create a dummy file object to simulate the file source.
const dummyFile = { src: 'dummy.adoc' };

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
      dynamicNotebookExt.register(registry, { contentCatalog: stubContentCatalog, file: dummyFile })
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
      dynamicNotebookExt.register(registry, { contentCatalog: stubContentCatalog, file: dummyFile })
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
      dynamicNotebookExt.register(registry, { contentCatalog: stubContentCatalog, file: dummyFile })
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
      dynamicNotebookExt.register(registry, { contentCatalog: stubContentCatalog, file: dummyFile })
      const doc = asciidoctor.load(input, { extension_registry: registry })
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
      dynamicNotebookExt.register(registry, { contentCatalog: stubContentCatalog, file: dummyFile })
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
    it('should not substitute < and > characters in Python code', () => {
      const input = `
:dynamic-blocks:

[%dynamic,python]
----
x = 15

if x < 10:
    print("x is less than 10")
elif x < 20:
    print("x is between 10 and 20")
else:
    print("x is 20 or greater")
----`
      const registry = asciidoctor.Extensions.create()
      dynamicNotebookExt.register(registry, { contentCatalog: stubContentCatalog, file: dummyFile })
      const doc = asciidoctor.load(input, { extension_registry: registry })
      const html = doc.convert()
      expect(html).to.eq(`<div class="listingblock">
<div class="content">
<pre class="highlight"><code class="language-python" data-lang="python">x = 15

if x &lt; 10:
    print("x is less than 10")
elif x &lt; 20:
    print("x is between 10 and 20")
else:
    print("x is 20 or greater")</code></pre>
</div>
</div>
<details>
<summary class="title">Results</summary>
<div class="content">
<div class="literalblock dynamic-py-result">
<div class="content">
<pre>x is between 10 and 20</pre>
</div>
</div>
</div>
</details>`)
    })
    it('should ignore callout in Python code', () => {
      const input = `
:dynamic-blocks:

[%dynamic,python]
----
x12 = 1/8
long_name = "A String" <1>

import cmath <2>
# Complex number handling
result = cmath.sqrt(-1) - 1j <3>

import math
x = math.sqrt(2)
value = math.sin(x) / x
print(f"value={value}") <4>

# The next command will display the result
x = math.cos(math.pi); print(f"x={x}") <5>
----
<.> Strings in Python are typically enclosed in double quotes \`"\` or single quotes \`'\`.
<.> Python's standard library \`math\` provides most of the mathematical functions. But for complex numbers, you would use the \`cmath\` module.
<.> For complex numbers, Python uses \`j\` instead of \`i\`.
<.> use \`print\` to display the result of a command in a script. In the interactive interpreter, the result is displayed by default. use \`f\` to format the output.
<.> In Python, there is no need to use \`;\` at the end of a statement unless you want to put multiple statements on a single line.`
      const registry = asciidoctor.Extensions.create()
      dynamicNotebookExt.register(registry, { contentCatalog: stubContentCatalog, file: dummyFile })
      const doc = asciidoctor.load(input, { extension_registry: registry })
      const html = doc.convert()
      expect(html).to.eq(`<div class="listingblock">
<div class="content">
<pre class="highlight"><code class="language-python" data-lang="python">x12 = 1/8
long_name = "A String" <b class="conum">(1)</b>

import cmath <b class="conum">(2)</b>
# Complex number handling
result = cmath.sqrt(-1) - 1j <b class="conum">(3)</b>

import math
x = math.sqrt(2)
value = math.sin(x) / x
print(f"value={value}") <b class="conum">(4)</b>

# The next command will display the result
x = math.cos(math.pi); print(f"x={x}") <b class="conum">(5)</b></code></pre>
</div>
</div>
<details>
<summary class="title">Results</summary>
<div class="content">
<div class="literalblock dynamic-py-result">
<div class="content">
<pre>value=0.6984559986366083
x=-1.0</pre>
</div>
</div>
</div>
</details>
<div class="colist arabic">
<ol>
<li>
<p>Strings in Python are typically enclosed in double quotes <code>"</code> or single quotes <code>'</code>.</p>
</li>
<li>
<p>Python&#8217;s standard library <code>math</code> provides most of the mathematical functions. But for complex numbers, you would use the <code>cmath</code> module.</p>
</li>
<li>
<p>For complex numbers, Python uses <code>j</code> instead of <code>i</code>.</p>
</li>
<li>
<p>use <code>print</code> to display the result of a command in a script. In the interactive interpreter, the result is displayed by default. use <code>f</code> to format the output.</p>
</li>
<li>
<p>In Python, there is no need to use <code>;</code> at the end of a statement unless you want to put multiple statements on a single line.</p>
</li>
</ol>
</div>`)
    })
  })
})
