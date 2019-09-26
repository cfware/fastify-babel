import fs from 'fs';
import path from 'path';
import test from 'ava';
import fetch from 'node-fetch';
import sts from 'string-to-stream';
import QuickLRU from 'quick-lru';
import fastifyModule from 'fastify';
import fastifyStatic from 'fastify-static';
import fastifyBabel from '..';

const fastifyPackage = JSON.parse(fs.readFileSync(require.resolve('fastify/package.json'), 'utf8'));
const fastifyMain = path.posix.join('/node_modules/fastify', fastifyPackage.main);
const staticContent = 'import fastify from \'fastify\';\n';
const babelResult = `import fastify from "${fastifyMain}";`;
const fromModuleSource = 'node_modules/fake-module/fake-module.js';
const fromModuleResult = `import fastify from "../fastify/${fastifyPackage.main}";`;

const appOpts = {
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
	error: 'Internal Server Error',
	message: 'Unknown option: .babelrcBroken. Check out https://babeljs.io/docs/en/babel-core/#options for more information about options.'
};

const babelrcBroken = true;

const babelrcError = {
	statusCode: 500,
	error: 'Internal Server Error',
	message: 'Babel Internal Error'
};

async function createServer(t, babelTypes, maskError, babelrc = {plugins: ['bare-import-rewrite']}) {
	/* Use of babel-plugin-bare-import-rewrite ensures fastify-babel does the
	 * right thing with payload.filename. */
	const babelOpts = {babelrc, babelTypes, maskError};
	const fastify = fastifyModule();

	fastify
		.get('/undefined.js', (req, reply) => reply.send())
		.get('/null.js', (req, reply) => {
			reply.header('content-type', 'text/javascript');
			reply.send(null);
		})
		.get('/nofile.js', (req, reply) => {
			reply.header('content-type', 'text/ecmascript');
			reply.send(staticContent);
		})
		.get(`/${fromModuleSource}`, (req, reply) => {
			const payload = sts(staticContent);
			payload.filename = path.join(__dirname, '..', fromModuleSource);

			reply.header('content-type', 'text/javascript');
			reply.send(payload);
		})
		.register(fastifyStatic, appOpts)
		.register(fastifyBabel, babelOpts);

	await t.notThrowsAsync(fastify.listen(0));
	fastify.server.unref();

	return `http://127.0.0.1:${fastify.server.address().port}`;
}

async function runTest(t, url, expected, {noBabel, babelTypes, babelrc, maskError} = {}) {
	const host = await createServer(t, babelTypes, maskError, babelrc);
	const options = {};
	if (noBabel) {
		options.headers = {'x-no-babel': 1};
	}

	const res = await fetch(host + url, options);
	const body = await res.text();

	t.is(body.replace(/\r\n/, '\n'), expected);
}

test('static app js', runTest, '/import.js', babelResult);
test('static app js with x-no-babel', runTest, '/import.js', staticContent, {noBabel: true});
test('static app txt', runTest, '/test.txt', staticContent);
test('static app txt with custom babelTypes regex', runTest, '/test.txt', babelResult, {babelTypes: /text/});
test('dynamic undefined js', runTest, '/undefined.js', '');
test('dynamic null js', runTest, '/null.js', '');
test('dynamic js without filename', runTest, '/nofile.js', babelResult);
test('from node_module', runTest, `/${fromModuleSource}`, fromModuleResult);
test('default error handling', runTest, '/error.js', JSON.stringify(errorMessage));
test('babel exception handling', runTest, '/import.js', JSON.stringify(babelrcError), {babelrc: {babelrcBroken}});
test('don\'t hide error details', runTest, '/import.js', JSON.stringify(unmaskedError), {babelrc: {babelrcBroken}, maskError: false});

test('static app js caching', async t => {
	const host = await createServer(t);
	const res1 = await fetch(host + '/import.js');
	const res2 = await fetch(host + '/import.js', {
		headers: {
			'If-None-Match': res1.headers.get('etag')
		}
	});

	t.is(res2.status, 304);
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
		.get('/nofile.js', (req, reply) => {
			reply.header('content-type', 'text/ecmascript');
			reply.header('last-modified', 'Mon, 12 Aug 2019 12:00:00 GMT');
			reply.send(staticContent);
		})
		.get('/uncachable.js', (req, reply) => {
			reply.header('content-type', 'text/ecmascript');
			reply.send(staticContent);
		})
		.register(fastifyStatic, appOpts)
		.register(fastifyBabel, {
			babelrc: {
				plugins: [
					'bare-import-rewrite',
					hitCounter
				]
			},
			cache,
			cacheHashSalt
		});
	await fastify.listen(0);
	const host = `http://127.0.0.1:${fastify.server.address().port}`;
	const doFetch = async (path, step, prevKeys) => {
		const res = await fetch(host + path);
		const body = await res.text();
		t.is(body, babelResult);
		t.is(hits, prevKeys ? 2 : step);
		const keys = [...cache.keys()];
		if (prevKeys) {
			t.deepEqual(keys, prevKeys);
		} else {
			t.is(keys.length, step);
		}

		return keys;
	};

	const doUncachable = async (prevKeys, step) => {
		const res = await fetch(host + '/uncachable.js');
		const body = await res.text();
		t.is(body, babelResult);
		t.is(hits, step);
		t.deepEqual([...cache.keys()], prevKeys);
	};

	const iter = async prevKeys => {
		let keys = await doFetch('/import.js', 1, prevKeys);
		if (prevKeys) {
			t.deepEqual(prevKeys, keys);
		}

		const [importKey] = prevKeys || keys;
		t.is(cache.get(importKey), babelResult);

		keys = await doFetch('/nofile.js', 2, prevKeys);
		const [nofileKey] = keys.filter(key => key !== importKey);
		t.is(cache.get(nofileKey), babelResult);

		return [importKey, nofileKey];
	};

	const keys1 = await iter();
	const keys2 = await iter(keys1);

	t.deepEqual(keys1, keys2);

	await doUncachable(keys1, 3);
	await doUncachable(keys1, 4);

	return keys1;
}

test('caching', async t => {
	const key = await testCache(t);
	const saltedKey = await testCache(t, 'salt the hash');
	t.notDeepEqual(key, saltedKey);
});
