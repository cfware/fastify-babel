import path from 'node:path';
import fp from 'fastify-plugin';
import babel from '@babel/core';
import hasha from 'hasha';

function shouldBabel(reply, options) {
    return options.babelTypes.test(reply.getHeader('Content-Type') || '');
}

function babelPlugin(fastify, options, next) {
    if (!options.babelTypes) {
        options.babelTypes = /(?:java|ecma)script/u;
    }

    const cacheSalt = options.cacheHashSalt ? hasha(options.cacheHashSalt, {algorithm: 'sha256'}) : '';

    fastify.addHook('onSend', babelOnSend);

    next();

    function actualSend(payload, next, hash, filename) {
        const babelOptions = {
            ...options.babelrc,
            filename: filename || path.join(process.cwd(), 'index.js')
        };

        try {
            const {code} = babel.transform(payload, babelOptions);
            if (hash) {
                options.cache.set(hash, code);
            }

            next(null, code);
        } catch (error) {
            let sendError = error;
            if (options.maskError !== false) {
                let message = 'Babel Internal Error';
                try {
                    message = `Babel Transform error ${error.code} at line ${error.loc.line}, column ${error.loc.column}.`;
                } catch {}

                /* istanbul ignore next */
                try {
                    // Current versions of babel set the property readonly but configurable
                    const desc = Object.getOwnPropertyDescriptor(sendError, 'message');
                    desc.value = message;
                    Object.defineProperty(sendError, 'message', desc);
                } catch {
                    // Last resort if 'message' property is not configurable
                    const {code} = sendError;
                    sendError = new Error(message);
                    sendError.code = code;
                }
            }

            next(sendError);
        }
    }

    function babelOnSend(requests, reply, payload, next) {
        if (requests.headers['x-no-babel'] !== undefined) {
            return next();
        }

        if (!shouldBabel(reply, options)) {
            return next();
        }

        if (payload === null) {
            return next();
        }

        reply.removeHeader('content-length');
        if (payload === '') {
            /* Skip babel if we have empty payload (304's for example). */
            return next(null, '');
        }

        let hash;
        if (options.cache) {
            const cacheTag = reply.getHeader('etag') || reply.getHeader('last-modified');
            /* If we don't have etag or last-modified assume this is dynamic and not worth caching */
            if (cacheTag) {
                /* Prefer payload.filename, then payload it is a string */
                const filename = typeof payload === 'string' ? payload : payload.filename;
                hash = hasha([cacheTag, filename, cacheSalt], {algorithm: 'sha256'});
                const result = options.cache.get(hash);

                if (result !== undefined) {
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

export default fp(babelPlugin, {
    fastify: '>=4.4.0',
    name: 'fastify-babel'
});
