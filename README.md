:feelpp: Feel++
# Asciidoctor Extensions by {feelpp}

A set of Asciidoctor extensions used by https://github.com/feelpp/feelpp[> {feelpp}].
There are not tied to {feelpp} and could be useful to other software.

== Executable Python blocks

Python source blocks with the `dynamic` option are executed only when the document declares `:dynamic-blocks:`. Blocks on one page share one IPython session and run in document order.

The execution contract can be configured with document attributes:

[cols="2,2,3",options="header"]
|===
|Attribute |Default |Meaning
|`dynamic-python-interpreter` |`python3` |Interpreter executable used without a shell
|`dynamic-blocks-strict` |false |Fail the document when any dynamic block fails
|`dynamic-blocks-timeout-seconds` |60 |Maximum duration for all dynamic blocks on one page; maximum 600
|`dynamic-blocks-max-output-bytes` |5242880 |Aggregate captured stdout and stderr limit; maximum 104857600
|`dynamic-python-isolate-user-site` |false |Use an isolated home and disable Python user-site packages
|===

Required blocks can also declare `fail-on-error` individually. Matplotlib blocks require a non-empty `figure-alt` attribute.

The child process receives an allowlisted environment. Arbitrary tokens and credentials are not inherited. Temporary paths are redirected to a workspace that is removed after success or failure. When `dynamic-python-isolate-user-site` is enabled, the home, cache, IPython, and Matplotlib paths are isolated as well, and imports cannot fall back to packages from the user's home directory. Enable it in locked virtual environments; the compatibility default retains user package and cache discovery for existing installations.

[IMPORTANT]
====
This feature executes trusted documentation code; it is not an operating-system sandbox. Run it in a job with read-only repository permissions, no publishing credentials, no private content checkout, and appropriate container or runner isolation.
====

== Releases

Releases are published from GitHub Actions using npm trusted publishing (OIDC); no npm access token is stored in the repository.

Before the first release, configure a trusted publisher for `@feelpp/asciidoctor-extensions` on npm with:

* Organization or user: `feelpp`
* Repository: `feelpp-asciidoctor-extensions`
* Workflow filename: `release.yml`
* Environment name: `npm`
* Allowed action: `npm publish`

The release workflow runs on tags named `v*`, tests the package, installs npm 11.5.1 for OIDC trusted publishing, publishes prereleases under the npm `next` dist-tag and stable versions under `latest`, then creates the matching GitHub Release.

To publish a prerelease:

[source,bash]
----
npm version prerelease --preid=rc
git push origin main --follow-tags
----

To publish a stable release:

[source,bash]
----
npm version 1.0.0
git push origin main --follow-tags
----

Confirm the publication with:

[source,bash]
----
npm view @feelpp/asciidoctor-extensions dist-tags
----
