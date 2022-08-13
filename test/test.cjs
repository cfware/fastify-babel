'use strict';
const fs = require('node:fs');
const path = require('node:path');
const t = require('libtap');
const fetch = require('node-fetch');
const sts = require('string-to-stream');
const QuickLRU = require('quick-lru');
const semver = require('semver');
const fastifyModule = require('fastify');
const fastifyStatic = require('@fastify/static');
const fastifyBabel = require('..');

const fastifyPackage = JSON.parse(fs.readFileSync(require.resolve('fastify/package.json'), 'utf8'));
const fastifyMain = path.posix.join('/node_modules/fastify', fastifyPackage.main);
const staticContent = 'import fastify from \'fastify\';\n';
const babelResult = `import fastify from "${fastifyMain}";`;
const fromModuleSource = 'node_modules/fake-module/fake-module.js';
const fromModuleResult = `import fastify from "../fastify/${fastifyPackage.main}";`;

const test = (name, helper, ...args) => t.test(name, t => helper(t, ...args));

const appOptions = {
	root: path.join(__dirname, '..', 'fixtures'),
	prefix: '/'
};

const errorMessage = {
	statusCode: 500,
	code: 'BABEL_PARSE_ERROR',
	error: 'Internal Server Error',
	message: 'Babel Transform error BABEL_PARSE_ERROR at line 1, column 0.'
};

const unmaskedError = {
	statusCode: 500,
	code: 'BABEL_UNKNOWN_OPTION',
	error: 'Internal Server Error',
	message: 'Unknown option: .babelrcBroken. Check out https://babeljs.io/docs/en/babel-core/#options for more information about options.'
};

const babelrcBroken = true;

const babelrcError = {
	statusCode: 500,
	code: 'BABEL_UNKNOWN_OPTION',
	error: 'Internal Server Error',
	message: 'Babel Internal Error'
};

const plugins = [
	['bare-import-rewrite', {
		modulesDir: '/node_modules'
	}]
];
const defaultBabelRC = {plugins};

async function createServer(t, babelTypes, maskError, babelrc = defaultBabelRC) {
	/* Use of babel-plugin-bare-import-rewrite ensures fastify-babel does the
	 * right thing with payload.filename. */
	const babelOptions = {babelrc, babelTypes, maskError};
	const fastify = fastifyModule();

	fastify
		.get('/undefined.js', (request, reply) => reply.send())
		.get('/null.js', (request, reply) => {
			reply.header('content-type', 'text/javascript');
			reply.send(null);
		})
		.get('/nofile.js', (request, reply) => {
			reply.header('content-type', 'text/ecmascript');
			reply.send(staticContent);
		})
		.get(`/${fromModuleSource}`, (request, reply) => {
			const payload = sts(staticContent);
			payload.filename = path.resolve(__dirname, '..', fromModuleSource);

			reply.header('content-type', 'text/javascript');
			reply.send(payload);
		})
		.register(fastifyStatic, appOptions)
		.register(fastifyBabel, babelOptions);

	await fastify.listen();
	t.teardown(() => fastify.server.unref());

	return `http://127.0.0.1:${fastify.server.address().port}`;
}

async function runTest(t, url, expected, {noBabel, babelTypes, babelrc, maskError} = {}) {
	const host = await createServer(t, babelTypes, maskError, babelrc);
	const options = {};
	if (noBabel) {
		options.headers = {'x-no-babel': 1};
	}

	const response = await fetch(host + url, options);
	const body = await response.text();

	t.equal(body.replace(/\r\n/u, '\n'), expected);
}

test('static app js', runTest, '/import.js', babelResult);
test('static app js with x-no-babel', runTest, '/import.js', staticContent, {noBabel: true});
test('static app txt', runTest, '/test.txt', staticContent);
test('static app txt with custom babelTypes regex', runTest, '/test.txt', babelResult, {babelTypes: /text/u});
test('dynamic undefined js', runTest, '/undefined.js', '');
test('dynamic null js', runTest, '/null.js', '');
test('dynamic js without filename', runTest, '/nofile.js', babelResult);
test('from node_module', runTest, `/${fromModuleSource}`, fromModuleResult);
test('default error handling', runTest, '/error.js', JSON.stringify(errorMessage));
test('babel exception handling', runTest, '/import.js', JSON.stringify(babelrcError), {babelrc: {babelrcBroken}});
test('don\'t hide error details', runTest, '/import.js', JSON.stringify(unmaskedError), {babelrc: {babelrcBroken}, maskError: false});

test('static app js caching', async t => {
	const host = await createServer(t);
	const response1 = await fetch(`${host}/import.js`);
	const response2 = await fetch(`${host}/import.js`, {
		headers: {
			'If-None-Match': response1.headers.get('etag')
		}
	});

	t.equal(response2.status, 304);
});

async function testCache(t, cacheHashSalt) {
	let hits = 0;
	const hitCounter = () => ({
		visitor: {
			Program() {
				hits++;
			}
		}
	});

	const fastify = fastifyModule();
	const cache = new QuickLRU({maxSize: 50});
	fastify
		.get('/nofile.js', (request, reply) => {
			reply.header('content-type', 'text/ecmascript');
			reply.header('last-modified', 'Mon, 12 Aug 2019 12:00:00 GMT');
			reply.send(staticContent);
		})
		.get('/uncachable.js', (request, reply) => {
			reply.header('content-type', 'text/ecmascript');
			reply.send(staticContent);
		})
		.register(fastifyStatic, appOptions)
		.register(fastifyBabel, {
			babelrc: {
				plugins: [
					...plugins,
					hitCounter
				]
			},
			cache,
			cacheHashSalt
		});
	await fastify.listen(0);
	const host = `http://127.0.0.1:${fastify.server.address().port}`;
	const doFetch = async (path, step, previousKeys) => {
		const response = await fetch(host + path);
		const body = await response.text();
		t.equal(body, babelResult);
		t.equal(hits, previousKeys ? 2 : step);
		const keys = [...cache.keys()];
		if (previousKeys) {
			t.same(keys, previousKeys);
		} else {
			t.equal(keys.length, step);
		}

		return keys;
	};

	const doUncachable = async (previousKeys, step) => {
		const response = await fetch(`${host}/uncachable.js`);
		const body = await response.text();
		t.equal(body, babelResult);
		t.equal(hits, step);
		t.same([...cache.keys()], previousKeys);
	};

	const iter = async previousKeys => {
		let keys = await doFetch('/import.js', 1, previousKeys);
		if (previousKeys) {
			t.same(previousKeys, keys);
		}

		const [importKey] = previousKeys || keys;
		t.equal(cache.get(importKey), babelResult);

		keys = await doFetch('/nofile.js', 2, previousKeys);
		const nofileKey = keys.find(key => key !== importKey);
		t.equal(cache.get(nofileKey), babelResult);

		return [importKey, nofileKey];
	};

	const keys1 = await iter();
	const keys2 = await iter(keys1);

	t.same(keys1, keys2);

	await doUncachable(keys1, 3);
	await doUncachable(keys1, 4);

	fastify.server.unref();

	return keys1;
}

test('caching', async t => {
	const key = await testCache(t);
	const saltedKey = await testCache(t, 'salt the hash');
	t.notSame(key, saltedKey);
});

if (semver.gte(process.versions.node, '13.10.0')) {
	test('test exports', async t => {
		const selfRef = require('fastify-babel');

		t.equal(fastifyBabel, selfRef);
	});
}
