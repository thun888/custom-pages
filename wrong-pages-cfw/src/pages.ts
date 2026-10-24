/**
 * 页面注册表
 *
 * 所有页面共用 src/templates/layout.html，一个页面只是一组差异参数。
 * 新增页面：
 * 1. 在下面的 pages 里加一条定义（标题、正文、配图、按钮）；
 * 2. 需要自动命中时，在 src/index.ts 的 RULES 里加一条规则。
 * 某个页面需要完全不同的结构时，再给它单独的模板。
 */

import layoutTemplate from './templates/layout.html';

export interface PageGeo {
	country: string;
	region: string;
	city: string;
	asOrg: string;
	asn: string;
}

/**
 * 一次页面渲染需要的全部数据，渲染过程不再读 request / env
 */
export interface PageContext {
	url: URL;
	status: number;
	time: string;
	ip: string;
	ua: string;
	ray: string;
	colo: string;
	geo: PageGeo;
	contactEmail: string;
	/** 错误上报 ID，未上报时为「无」 */
	reportId: string;
}

export interface PageDefinition {
	/** 页面默认状态码，规则或上游状态码可以覆盖 */
	status: number;
	/** 命中后是否发送错误报告 */
	notify: boolean;
	/** 对命令行 / agent/cli程序类 UA 返回 JSON 而不是 HTML */
	jsonForPlainUa?: boolean;
	title: (context: PageContext) => string;
	/** 页面大标题 */
	heading: string;
	/** 邮件按钮文案 */
	buttonText: string;
	image: (context: PageContext) => string;
	/** HTML 片段 */
	content?: (context: PageContext) => string;
	/** mailto 链接 */
	email: (context: PageContext) => string;
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

export function getStatusText(status: number): { en: string; zh: string } {
	return STATUS_TEXTS[status] ?? { en: 'Server Error', zh: '服务器错误' };
}

type TemplateVars = Record<string, string>;

/**
 * 替换模板里的 {{name}}，值原样写入。
 * 用函数作为 replace 的替换值，可以避免值里的 $& 被当成替换模式。
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
	return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
		const value = vars[key];
		if (value === undefined) {
			throw new Error(`模板缺少变量：${key}`);
		}
		return value;
	});
}

const PLAIN_UA_LIST = ['claude', 'deepseek-harness', 'codex'];

export function isPlainUa(context: PageContext): boolean {
	const ua = context.ua.toLowerCase();
	return PLAIN_UA_LIST.some((item) => ua.includes(item));
}

/** 每次请求只采集一次页面数据 */
export function buildPageContext(
	request: Request,
	status: number,
	env: { CONTACT_EMAIL?: string }
): PageContext {
	const url = new URL(request.url);
	const cf = request.cf;

	return {
		url,
		status,
		time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
		ip: request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '未知',
		ua: request.headers.get('User-Agent') || '未知',
		ray: request.headers.get('CF-Ray')?.split('-')[0] || '未知',
		colo: String(cf?.colo ?? '未知'),
		geo: {
			country: String(cf?.country ?? '未知'),
			region: String(cf?.region ?? '未知'),
			city: String(cf?.city ?? '未知'),
			asOrg: String(cf?.asOrganization ?? '未知'),
			asn: String(cf?.asn ?? '未知'),
		},
		contactEmail: env.CONTACT_EMAIL || 'example@example.com',
		reportId: '无',
	};
}

function geoLine(context: PageContext): string {
	const { country, region, city, asOrg, asn } = context.geo;
	return `${country}/${region}/${city}/${asOrg}/${asn}`;
}

function imageForStatus(status: number): string {
	if (status === 403) return '/__cfw_assets/img/403.webp';
	if (status === 404) return '/__cfw_assets/img/404.webp';
	return '/__cfw_assets/img/5xx.webp';
}

function errorContent(context: PageContext): string {
	const statusText = getStatusText(context.status);

	return `
		<div style="background: rgba(180, 142, 106, 0.1); border-radius: 8px; padding: 16px; margin: 12px 0;">
			<p style="margin: 8px 0;"><strong>错误代码：</strong>${context.status}
				<span class="status-text">${statusText.en}<span class="zh">${statusText.zh}</span></span>
			</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>请求地址：</strong>${context.url.href}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>Cloudflare事件ID：</strong>${context.ray}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>Cloudflare节点：</strong>${context.colo}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>用户IP：</strong>${context.ip}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>用户信息：</strong>${geoLine(context)}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>用户代理：</strong>${context.ua}</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>请求时间：</strong>${context.time} (Asia/Shanghai)</p>
			<p style="margin: 8px 0; font-size: 0.8rem;"><strong>错误上报ID：</strong>${context.reportId}</p>
		</div>
	`;
}

function errorEmail(context: PageContext): string {
	const statusText = getStatusText(context.status);
	const mail = new URLSearchParams({
		subject: '错误报告',
		body: `错误代码：${context.status} ${statusText.en} (${statusText.zh})
	请求地址：${context.url.href}
	Cloudflare事件ID：${context.ray}
	用户IP：${context.ip}
	用户信息：${geoLine(context)}
	用户代理：${context.ua}
	错误上报ID：${context.reportId}
	请求时间：${context.time}`,
	});

	return `mailto:${context.contactEmail}?${mail.toString()}`;
}

const pages = {
	error: {
		status: 500,
		notify: true,
		jsonForPlainUa: true,
		heading: '很抱歉，我们遇到了一些问题',
		buttonText: '发送邮件协助我们',
		title: (context: PageContext) => {
			const statusText = getStatusText(context.status);
			return `${context.status} ${statusText.en} | ${statusText.zh}`;
		},
		image: (context: PageContext) => imageForStatus(context.status),
		content: errorContent,
		email: errorEmail,
	},
	stopped: {
		status: 403,
		notify: false,
		heading: '该网站已停止访问！',
		buttonText: '发送邮件',
		title: () => '该网站已停止访问！',
		image: () => '/__cfw_assets/img/403.webp',
		content: () => '<p>如有需要，请通过邮件或其他方式联系我</p>',
		email: (context: PageContext) => `mailto:${context.contactEmail}`,
	},
} satisfies Record<string, PageDefinition>;

export type PageKey = keyof typeof pages;

export const PAGES: Record<PageKey, PageDefinition> = pages;

export function renderPage(page: PageDefinition, context: PageContext): Response {
	const vars: TemplateVars = {
		title: page.title(context),
		heading: page.heading,
		image: page.image(context),
		email: page.email(context),
		buttonText: page.buttonText,
		content: page.content ? page.content(context) : '',
	};

	return new Response(renderTemplate(layoutTemplate, vars), {
		status: context.status,
		headers: {
			'Content-Type': 'text/html;charset=UTF-8',
		},
	});
}

export function renderPlain(context: PageContext): Response {
	const statusText = getStatusText(context.status);

	return new Response(
		JSON.stringify({
			status: context.status,
			message: `${statusText.en} (${statusText.zh}), please contact ${context.contactEmail} with error report ID: ${context.reportId}`,
		}),
		{
			status: context.status,
			headers: {
				'Content-Type': 'application/json;charset=UTF-8',
			},
		}
	);
}
