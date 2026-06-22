/**
 * Cloudflare Worker - 错误页面代理
 *
 * 功能：
 * 1. 代理转发请求到上游源站
 * 2. 当上游返回 5xx 错误时，自动返回错误页面
 * 3. 将请求信息填入 ::CLOUDFLARE_ERROR_500S_BOX:: 占位符
 */

// 导入 HTML 模板
import htmlContent from '../public/50x-cf.html';

// HTTP 状态码对应的描述文本
const STATUS_TEXTS: Record<number, string> = {
	500: 'Internal Server Error',
	502: 'Bad Gateway',
	503: 'Service Unavailable',
	504: 'Gateway Timeout',
	522: 'Connection Timed Out',
};

/**
 * 获取状态码的描述文本
 */
function getStatusText(status: number): string {
	return STATUS_TEXTS[status] || 'Server Error';
}

/**
 * 生成错误响应
 */
function generateErrorResponse(status: number, request: Request): Response {
	const statusText = getStatusText(status);
	const url = new URL(request.url);
	const timestamp = new Date().toLocaleString('zh-CN', {
		timeZone: 'Asia/Shanghai',
	});
	const userIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '未知';
	const userAgent = request.headers.get('User-Agent') || '未知';
	const cfRay = request.headers.get('CF-Ray')?.split('-')[0] || '未知';
	// const cfColo = request.headers.get('CF-Ray')?.split('-')[1]|| '未知';

	// 构建错误信息盒子
	const errorBox = `
		<div style="background: rgba(180, 142, 106, 0.1); border-radius: 8px; padding: 16px; margin: 12px 0;">
			<p style="margin: 8px 0;"><strong>错误代码：</strong>${status} ${statusText}</p>
			<p style="margin: 8px 0;"><strong>请求地址：</strong>${url.href}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>Cloudflare事件ID：</strong>${cfRay}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>Cloudflare节点：</strong><span id="cfColo">获取中...</span></p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>用户IP：</strong>${userIP}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>用户代理：</strong>${userAgent}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>请求时间：</strong>${timestamp}</p>
		</div>
	`;

	// 替换占位符
	let html = htmlContent.replace('::CLOUDFLARE_ERROR_500S_BOX::', errorBox);
	// 替换邮件发送内容
	html = html.replace('mailto:thun888@hzchu.top', `mailto:thun888@hzchu.top?subject=错误报告&body=错误代码：${status} ${statusText}%0A请求地址：${url.href}%0ACloudflare事件ID：${cfRay}%0A用户IP：${userIP}%0A用户代理：${userAgent}%0A请求时间：${timestamp}`);

	return new Response(html, {
		status: status,
		headers: {
			'Content-Type': 'text/html;charset=UTF-8',
		},
	});
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			const url = new URL(request.url);

			// 测试后门：?test=1，强制显示 503
			if (url.searchParams.get('test') === '1') {
				return generateErrorResponse(503, request);
			}

			// 代理请求到上游源站
			const response = await fetch(request);

			// 拦截 5xx 错误
			if (response.status >= 500) {
				return generateErrorResponse(response.status, request);
			}

			return response;
		} catch (e) {
			// 彻底断网时的兜底，默认给 522
			return generateErrorResponse(522, request);
		}
	},
} satisfies ExportedHandler<Env>;
