import path from 'path';
import test from 'ava';
import fetch from 'node-fetch';
import sts from 'string-to-stream';
import fastifyPackage from 'fastify/package';
import fastifyModule from 'fastify';
import fastifyStatic from 'fastify-static';
import fastifyBabel from '..';

const fastifyMain = path.posix.join('/node_modules/fastify', fastifyPackage.main);
const staticContent = 'import fastify from \'fastify\';\n';
const babelResult = `import fastify from "${fastifyMain}";`;
const fromModuleSource = 'node_modules/fake-module/fake-module.js';
const fromModuleResult = `import fastify from "../fastify/${fastifyPackage.main}";`;

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
	const appOpts = {
		root: path.join(__dirname, 'fixtures'),
		prefix: '/'
	};
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

test('static app js', runTest, '/test.js', babelResult);
test('static app js with x-no-babel', runTest, '/test.js', staticContent, {noBabel: true});
test('static app txt', runTest, '/test.txt', staticContent);
test('static app txt with custom babelTypes regex', runTest, '/test.txt', babelResult, {babelTypes: /text/});
test('dynamic undefined js', runTest, '/undefined.js', '');
test('dynamic null js', runTest, '/null.js', '');
test('dynamic js without filename', runTest, '/nofile.js', babelResult);
test('from node_module', runTest, `/${fromModuleSource}`, fromModuleResult);
test('default error handling', runTest, '/error.js', JSON.stringify(errorMessage));
test('babel exception handling', runTest, '/test.js', JSON.stringify(babelrcError), {babelrc: {babelrcBroken}});
test('don\'t hide error details', runTest, '/test.js', JSON.stringify(unmaskedError), {babelrc: {babelrcBroken}, maskError: false});

test('static app js caching', async t => {
	const host = await createServer(t);
	const res1 = await fetch(host + '/test.js');
	const res2 = await fetch(host + '/test.js', {
		headers: {
			'If-None-Match': res1.headers.get('etag')
		}
	});

	t.is(res2.status, 304);
});
