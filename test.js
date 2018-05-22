import path from 'path';
import test from 'ava';
import got from 'got';
import sts from 'string-to-stream';
import fastifyPackage from 'fastify/package';
import fastifyModule from 'fastify';
import fastifyStatic from 'fastify-static';
import fastifyBabel from '.';

const fastifyMain = path.join('/node_modules/fastify', fastifyPackage.main);
const staticContent = `import fastify from 'fastify';\n`;
const babelResult = `import fastify from "${fastifyMain}";`;
const fromModuleSource = 'node_modules/fake-module/fake-module.js';
const fromModuleResult = `import fastify from "../fastify/${fastifyPackage.main}";`;

/* eslint-disable max-params */
async function createServer(t, babelTypes) {
	const appOpts = {
		root: path.join(__dirname, 'fixtures'),
		prefix: '/',
	};
	/* Use of babel-plugin-bare-import-rewrite ensures fastify-babel does the
	 * right thing with payload.filename. */
	const babelOpts = {
		babelrc: {
			plugins: ['bare-import-rewrite'],
		},
		babelTypes,
	};
	const fastify = fastifyModule();

	fastify
		.get('/undefined.js', (req, reply) => reply.send())
		.get('/null.js', (req, reply) => {
			reply.header('content-type', 'text/javascript');
			reply.send(null);
		})
		.get('/nofile.js', (req, reply) => {
			reply.header('content-type', 'text/javascript');
			reply.send(staticContent);
		})
		.get(`/${fromModuleSource}`, (req, reply) => {
			const payload = sts(staticContent);
			payload.filename = path.join(__dirname, fromModuleSource);

			reply.header('content-type', 'text/javascript');
			reply.send(payload);
		})
		.register(fastifyStatic, appOpts)
		.register(fastifyBabel, babelOpts);

	await t.notThrows(fastify.listen(0));
	fastify.server.unref();

	return `http://127.0.0.1:${fastify.server.address().port}`;
}

async function runTest(t, url, expected, noBabel, babelTypes) {
	const host = await createServer(t, babelTypes);
	const options = {};
	if (noBabel) {
		options.headers = {'x-no-babel': 1};
	}
	const {body} = await got(host + url, options);

	t.is(body, expected);
}

test('static app js', t => runTest(t, '/test.js', babelResult));
test('static app js with x-no-babel', t => runTest(t, '/test.js', staticContent, true));
test('static app txt', t => runTest(t, '/test.txt', staticContent));
test('static app txt with custom babelTypes regex', t => runTest(t, '/test.txt', babelResult, false, /text/));
test('dynamic undefined js', t => runTest(t, '/undefined.js', ''));
test('dynamic null js', t => runTest(t, '/null.js', ''));
test('dynamic js without filename', t => runTest(t, '/nofile.js', babelResult));
test('from node_module', t => runTest(t, `/${fromModuleSource}`, fromModuleResult));

test('static app js caching', async t => {
	const host = await createServer(t);
	const resp1 = await got(host + '/test.js');
	const resp2 = await got(host + '/test.js', {
		headers: {
			'If-None-Match': resp1.headers.etag,
		},
	});

	t.is(resp2.statusCode, 304);
});
