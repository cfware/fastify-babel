'use strict';

const path = require('path');
const fp = require('fastify-plugin');
const babel = require('@babel/core');
const hasha = require('hasha');

function shouldBabel(reply, opts) {
	return opts.babelTypes.test(reply.getHeader('Content-Type') || '');
}

function babelPlugin(fastify, opts, next) {
	if (!opts.babelTypes) {
		opts.babelTypes = /(java|ecma)script/;
	}

	const cacheSalt = opts.cacheHashSalt ? hasha(opts.cacheHashSalt, {algorithm: 'sha256'}) : '';

	fastify.addHook('onSend', babelOnSend);

	next();

	function actualSend(payload, next, hash, filename) {
		const babelOpts = {
			...opts.babelrc,
			filename: filename || path.join(process.cwd(), 'index.js')
		};

		try {
			const {code} = babel.transform(payload, babelOpts);
			if (hash) {
				opts.cache.set(hash, code);
			}

			next(null, code);
		} catch (error) {
			if (opts.maskError !== false) {
				error.message = 'Babel Internal Error';
				try {
					error.message = `Babel Transform error ${error.code} at line ${error.loc.line}, column ${error.loc.column}.`;
				} catch (error) {
				}
			}

			next(error);
		}
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

		reply.removeHeader('content-length');
		if (payload === '') {
			/* Skip babel if we have empty payload (304's for example). */
			return next(null, '');
		}

		let hash;
		if (opts.cache) {
			const cacheTag = reply.getHeader('etag') || reply.getHeader('last-modified');
			/* If we don't have etag or last-modified assume this is dynamic and not worth caching */
			if (cacheTag) {
				/* Prefer payload.filename, then payload it is a string */
				const filename = typeof payload === 'string' ? payload : payload.filename;
				hash = hasha([cacheTag, filename, cacheSalt], {algorithm: 'sha256'});
				const result = opts.cache.get(hash);

				if (typeof result !== 'undefined') {
					next(null, result);
					return;
				}
			}
		}

		if (typeof payload === 'string') {
			actualSend(payload, next, hash);
			return;
		}

		const code = [];
		payload.on('data', chunk => code.push(chunk));
		payload.on('end', () => actualSend(code.join(''), next, hash, payload.filename));
	}
}

module.exports = fp(babelPlugin, {
	fastify: '>=2.7.1',
	name: 'fastify-babel'
});
