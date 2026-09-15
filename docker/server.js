#!/usr/bin/env node
/**
 * Server entry point, placed at /community-server/bin/server.js in the Docker image.
 *
 * The official `solidproject/community-server` image is started with
 * `node bin/server.js`, so keeping that same entry point available means a
 * Dockerfile building on this image only needs to change its `FROM` line.
 *
 * The image root is this package rather than the Community Solid Server, so the
 * server's own `bin/server.js` cannot be reused as-is: the `require('..')` in it
 * would resolve to this package. Requiring it by name instead loads it from
 * node_modules, where the rest of the server is resolved from as well.
 *
 * Which Components.js modules are available is determined by the
 * CSS_MAIN_MODULE_PATH environment variable set in the Dockerfile.
 */
require('@solid/community-server/bin/server.js');
