# fastify-babel

[![Travis CI][travis-image]][travis-url]
[![Greenkeeper badge][gk-image]](https://greenkeeper.io/)
[![NPM Version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]
[![MIT][license-image]](LICENSE)

Fastify Babel plugin for development servers

### Never load this plugin on production servers

The purpose of this module is for running a test HTTP server directly from
sources.  Babel transformations are not async and all additional requests are
blocked while transformation is in process.

You should always use a build step to install pre-transformed files to production
servers.

### Install fastify-babel

This module requires node.js 8 or above.  It is should normally be used
with `fastify-static >= 0.12.0`.  This module expects to the local filename
to be in `payload.filename`.

```sh
npm i --save-dev fastify-babel @babel/core
```

## Usage

```js
'use strict';

const path = require('path');
const fastify = require('fastify')();
const fastifyStatic = require('fastify-static');
const fastifyBabel = require('fastify-babel');

fastify
	.register(fastifyStatic, {
		root: path.join(__dirname, 'html/myapp'),
		prefix: '/myapp',
	})
	.register(fastifyStatic, {
		root: path.join(__dirname, 'node_modules'),
		prefix: '/node_modules',
		decorateReply: false,
	})
	.register(fastifyBabel, {
		babelrc: {
			plugins: ['bare-import-rewrite'],
		},
	})
	.listen(3000, '127.0.0.1', err => {
		if (err) {
			throw err;
		}
		console.log(`server listening at http://127.0.0.1:${fastify.server.address().port}/`);
	});
```

In addition to `fastify-babel` this example requires `fastify-static` and
`babel-plugin-bare-import-rewrite`.

## Options

### `babelrc`

An object provided directly to babel for each request that is processed.
Default is empty.

### `babelTypes`

A `RegExp` object used to match the `Content-Type` header.  Only replies with
matching header will be processed by babel.  Default `/(java|ecma)script/`.

### `maskError`

Setting this to `false` will allow the full error message to be displayed.  By
default errors are masked to prevent disclosure of server details.

### `cache`

A Map-like object for caching transform results.  This object must have support
for both `get` and `set` methods.

### `cacheHashSalt`

A string used to salt the hash of source content.

## Running tests

Tests are provided by xo and ava.

```sh
npm install
npm test
```

## `fastify-babel` for enterprise

Available as part of the Tidelift Subscription.

The maintainers of `fastify-babel` and thousands of other packages are working with Tidelift to deliver commercial support and maintenance for the open source dependencies you use to build your applications. Save time, reduce risk, and improve code health, while paying the maintainers of the exact dependencies you use. [Learn more.](https://tidelift.com/subscription/pkg/npm-fastify-babel?utm_source=npm-fastify-babel&utm_medium=referral&utm_campaign=enterprise&utm_term=repo)

[npm-image]: https://img.shields.io/npm/v/fastify-babel.svg
[npm-url]: https://npmjs.org/package/fastify-babel
[travis-image]: https://travis-ci.org/cfware/fastify-babel.svg?branch=master
[travis-url]: https://travis-ci.org/cfware/fastify-babel
[gk-image]: https://badges.greenkeeper.io/cfware/fastify-babel.svg
[downloads-image]: https://img.shields.io/npm/dm/fastify-babel.svg
[downloads-url]: https://npmjs.org/package/fastify-babel
[license-image]: https://img.shields.io/github/license/cfware/fastify-babel.svg
