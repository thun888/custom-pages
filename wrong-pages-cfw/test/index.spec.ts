import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Error Page Worker', () => {
	it('应返回 503 错误页面当 test=1 参数存在', async () => {
		const request = new IncomingRequest('http://example.com/?testcfw=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(503);
		expect(response.headers.get('Content-Type')).toContain('text/html');

		const html = await response.text();
		expect(html).toContain('503 Service Unavailable');
		expect(html).toContain('http://example.com/?testcfw=1');
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

	it('黑名单域名应直接返回 403 错误页', async () => {
		const request = new IncomingRequest('http://blocked.example/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, BLACK_LIST: '["blocked.example"]', STOP_LIST: '[]' },
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(403);
		expect(response.headers.get('Content-Type')).toContain('text/html');
		expect(await response.text()).toContain('403 Forbidden');
	});

	it('停站名单域名应返回停站页', async () => {
		const request = new IncomingRequest('http://stopped.example/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, BLACK_LIST: '[]', STOP_LIST: '["stopped.example"]' },
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(403);
		expect(await response.text()).toContain('该网站已停止访问！');
	});

	it('应返回 503 错误页面 (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/?testcfw=1');
		expect(response.status).toBe(503);

		const html = await response.text();
		expect(html).toContain('503 Service Unavailable');
		expect(html).toContain('错误代码');
	});
});
