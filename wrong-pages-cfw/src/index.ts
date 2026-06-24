/**
 * Cloudflare Worker - 错误页面代理
 *
 * 功能：
 * 1. 代理转发请求到上游源站
 * 2. 当上游返回 5xx 错误时，自动返回错误页面
 * 3. 将请求信息填入 ::CARD_CONTENT_REPLACE_BOX:: 占位符
 * 4. 自动发送 Telegram 错误报告
 */

// 导入 HTML 模板
import htmlTemplate from '../public/template.html';
// 导入 black-list.json
import blackList from '../public/black-list.json' ;
// 哈希
import { createHash } from 'crypto';

// 扩展 Env 接口以包含 Telegram 配置
interface Env {
	TG_BOT_TOKEN?: string;
	TG_CHAT_ID?: string;
	CONTACT_EMAIL?: string; // 错误报告收件人邮箱
	SKIP_NOTIFY?: boolean; // 测试标志
	ASSETS: Fetcher;
}

// HTTP 状态码对应的描述文本（Cloudflare 5xx 错误码）
// 英文和中文分开存储，前端通过鼠标悬浮切换显示
const STATUS_TEXTS: Record<number, { en: string; zh: string }> = {
	403: { en: 'Forbidden', zh: '禁止访问该域名' },
	404: { en: 'Not Found', zh: '未找到资源' },
	405: { en: 'Method Not Allowed', zh: '方法不被允许' },
	500: { en: 'Internal Server Error', zh: '源站服务器内部错误' },
	501: { en: 'Not Implemented', zh: '服务不支持' },
	502: { en: 'Bad Gateway', zh: '源站返回异常' },
	503: { en: 'Service Unavailable', zh: '服务不可用' },
	504: { en: 'Gateway Timeout', zh: '源站响应超时' },
	520: { en: 'Unknown Error', zh: '源站返回异常响应' },
	521: { en: 'Web Server Down', zh: '源站拒绝连接' },
	522: { en: 'Connection Timed Out', zh: 'Cloudflare 连接源站超时' },
	523: { en: 'Origin Unreachable', zh: '源站不可达' },
	524: { en: 'A Timeout Occurred', zh: '已连接但响应超时' },
	525: { en: 'SSL Handshake Failed', zh: 'SSL 握手失败' },
	526: { en: 'Invalid SSL Certificate', zh: '证书无效' },
	530: { en: 'Origin Error', zh: '源站错误' },
};

/**
 * 获取状态码的描述文本
 */
function getStatusText(status: number): { en: string; zh: string } {
	return STATUS_TEXTS[status] || { en: 'Server Error', zh: '服务器错误' };
}

/**
 * 发送 Telegram 错误报告
 */
async function sendTelegramReport(
	botToken: string,
	chatId: string,
	status: number,
	statusText: { en: string; zh: string },
	url: string,
	cfRay: string,
	userIP: string,
	userAgent: string,
	userCountry: string,
	userRegion: string,
	userCity: string,
	userAsOrganization: string,
	userAsn: string,
	timestamp: string
): Promise<string | undefined> {

	const domain_short_hash = createHash('sha256').update(new URL(url).hostname).digest('hex').slice(0, 8);
	const message = `#${domain_short_hash} CF错误报告
*错误代码:* ${status} ${statusText.en} | ${statusText.zh}

*请求地址:* ${url}
*Cloudflare事件ID:* ${cfRay}
*用户IP:* ${userIP}
*用户信息:* ${userCountry}/${userRegion}/${userCity}/${userAsOrganization}/${userAsn}
*用户代理:* ${userAgent.substring(0, 50)}${userAgent.length > 50 ? '...' : ''}
*请求时间:* ${timestamp}`;

	try {
		const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text: message,
				parse_mode: 'Markdown',
        		disable_web_page_preview: true,
			}),
		});
		const data: any = await res.json();
		if (!data.ok) {
			throw new Error(`Telegram API error: ${data.description}`);
		}
		return data.result.message_id;
	} catch (e) {
		console.error('Telegram report failed:', e);
		return undefined;
	}
}

/**
 * 生成错误响应
 */
async function generateErrorResponse(status: number, request: Request, env: Env): Promise<Response> {
	const statusText = getStatusText(status);
	const url = new URL(request.url);
	const timestamp = new Date().toLocaleString('zh-CN', {
		timeZone: 'Asia/Shanghai',
	});
	const userIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '未知';
	const userAgent = request.headers.get('User-Agent') || '未知';
	const cfRay = request.headers.get('CF-Ray')?.split('-')[0] || '未知';
	const cfColo = request.cf?.colo || '未知';

	const userCountry = request.cf?.country as string || '未知';
	const userRegion = request.cf?.region as string || '未知';
	const userCity = request.cf?.city as string || '未知';
	const userAsOrganization = request.cf?.asOrganization as string || '未知';
	const userAsn = request.cf?.asn as string || '未知';

	let tg_message_id: string | undefined = "无";
	// 异步发送 Telegram 报告
	if (env.TG_BOT_TOKEN && env.TG_CHAT_ID && !env.SKIP_NOTIFY && !url.href.endsWith('favicon.ico')) {
		tg_message_id = await sendTelegramReport(env.TG_BOT_TOKEN, env.TG_CHAT_ID, status, statusText, url.href, cfRay, userIP, userAgent, userCountry, userRegion, userCity, userAsOrganization, userAsn, timestamp);
	}

	// 构建错误信息盒子
	const errorBox = `
		<div style="background: rgba(180, 142, 106, 0.1); border-radius: 8px; padding: 16px; margin: 12px 0;">
			<p style="margin: 8px 0;"><strong>错误代码：</strong>${status}
				<span class="status-text">${statusText.en}<span class="zh">${statusText.zh}</span></span>
			</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>请求地址：</strong>${url.href}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>Cloudflare事件ID：</strong>${cfRay}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>Cloudflare节点：</strong>${cfColo}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>用户IP：</strong>${userIP}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>用户信息：</strong>${userCountry}/${userRegion}/${userCity}/${userAsOrganization}/${userAsn}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>用户代理：</strong>${userAgent}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>请求时间：</strong>${timestamp} (Asia/Shanghai)</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>错误上报ID：</strong>${tg_message_id}</p>
		</div>
	`;

	// 替换占位符
	let html = htmlTemplate.replace('::CARD_CONTENT_REPLACE_BOX::', errorBox);
	// 替换邮件发送内容
	const mail = new URLSearchParams({
	subject: "错误报告",
	body: `错误代码：${status} ${statusText.en} (${statusText.zh})
	请求地址：${url.href}
	Cloudflare事件ID：${cfRay}
	用户IP：${userIP}
	用户信息：${userCountry}/${userRegion}/${userCity}/${userAsOrganization}/${userAsn}
	用户代理：${userAgent}
	错误上报ID：${tg_message_id}
	请求时间：${timestamp}`,
	});

	const contactEmail = env.CONTACT_EMAIL || 'example@example.com';
	html = html.replace(
		"::EMAIL_REPLACE_BOX::",
		`mailto:${contactEmail}?${mail.toString()}`
	);

	// 替换标题
	html = html.replaceAll('::TITLE_REPLACE_BOX::', `${status} ${statusText.en} | ${statusText.zh}`);
	let imageUrl = '/__cfw_assets/img/';
	if (status === 403) {
		imageUrl += '403.webp';
	} else if (status === 404) {
		imageUrl += '404.webp';
	} else {
		imageUrl += '5xx.webp';
	}
	html = html.replace('::WRONG_IMAGE_REPLACE_BOX::', imageUrl);
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

			// 屏蔽域名
			const hostname = url.hostname.toLowerCase();
			if (blackList.includes(hostname) && !url.pathname.startsWith('/.well-known/') && !url.pathname.startsWith('/__cfw_assets/')) {
				env.SKIP_NOTIFY = true;
				return generateErrorResponse(403, request, env);
			}

			// 测试后门：?testcfw=1，强制显示 503
			if (url.searchParams.get('testcfw') === '1') {
				env.SKIP_NOTIFY = true;
				return generateErrorResponse(503, request, env);
			}

			if (url.pathname.startsWith('/__cfw_assets/')) {
				// 处理静态资源请求
				const imageResp = await env.ASSETS.fetch("https://assets.local/" + url.pathname.replace('/__cfw_assets/', ''));
				if (!imageResp.ok) {
					env.SKIP_NOTIFY = true;
					return generateErrorResponse(imageResp.status, request, env);
				}
				return imageResp;
			}

			// 代理请求到上游源站
			const response = await fetch(request);

			// 拦截 5xx 错误
			if (response.status >= 500) {
				return generateErrorResponse(response.status, request, env);
			}

			return response;
		} catch (e) {
			// 彻底断网时的兜底，默认给 522
			return generateErrorResponse(522, request, env);
		}
	},
} satisfies ExportedHandler<Env>;
