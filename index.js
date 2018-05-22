'use strict';

const path = require('path');
const fp = require('fastify-plugin');
const babel = require('@babel/core');

function shouldBabel(reply, opts) {
	return opts.babelTypes.test(reply.getHeader('Content-Type') || '');
}

function babelPlugin(fastify, opts, next) {
	if (!opts.babelTypes) {
		opts.babelTypes = /javascript/;
	}

	fastify.addHook('onSend', babelOnSend);

	next();

	function actualSend(payload, next, filename) {
		const babelOpts = {
			...opts.babelrc,
			filename: filename || path.join(process.cwd(), 'index.js'),
		};
		next(null, babel.transform(payload, babelOpts).code);
	}

	function babelOnSend(req, reply, payload, next) {
		if (req.headers['x-no-babel'] !== undefined) {
			return next();
		}

		if (!shouldBabel(reply, opts)) {
			return next();
		}

		if (payload === null) {
			reply.res.log.warn('babel: missing payload');
			return next();
		}

		if (payload === '') {
			/* Skip babel if we have empty payload (304's for example). */
			return next(null, '');
		}

		if (typeof payload === 'string') {
			actualSend(payload, next);
			return;
		}

		let code = '';
		payload.on('data', chunk => {
			code += chunk;
		});
		payload.on('end', () => {
			reply.removeHeader('content-length');

			actualSend(code, next, payload.filename);
		});
	}
}

module.exports = fp(babelPlugin, {
	fastify: '>=1.4.0',
	name: 'fastify-babel',
});
