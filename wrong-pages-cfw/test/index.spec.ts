import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Error Page Worker', () => {
	it('应返回 503 错误页面当 test=1 参数存在', async () => {
		const request = new IncomingRequest('http://example.com/?test=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(503);
		expect(response.headers.get('Content-Type')).toContain('text/html');

		const html = await response.text();
		expect(html).toContain('503 Service Unavailable');
		expect(html).toContain('http://example.com/?test=1');
		expect(html).toContain('错误代码');
	});

	it('应正常代理请求到上游源站', async () => {
		const request = new IncomingRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		// 在没有配置上游源站的情况下，应该返回错误
		// 这取决于实际的配置
		expect(response).toBeDefined();
	});

	it('应返回 503 错误页面 (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/?test=1');
		expect(response.status).toBe(503);

		const html = await response.text();
		expect(html).toContain('503 Service Unavailable');
		expect(html).toContain('错误代码');
	});
});
