/**
 * Cloudflare Worker - 错误页面代理
 *
 * 功能：
 * 1. 代理转发请求到上游源站
 * 2. 名单命中 / 上游 5xx 时，按页面注册表渲染错误页
 * 3. 自动发送 Telegram 错误报告
 *
 * 页面定义在 src/pages.ts，上报逻辑在 src/notify.ts。
 */

import { PAGES, buildPageContext, isPlainUa, renderPage, renderPlain, type PageKey } from './pages';
import { sendTelegramReport } from './notify';

// 扩展 Env 接口以包含 Telegram 配置
interface Env {
	TG_BOT_TOKEN?: string;
	TG_CHAT_ID?: string;
	CONTACT_EMAIL?: string; // 错误报告收件人邮箱
	BLACK_LIST?: string; // 黑名单域名，JSON 格式
	STOP_LIST?: string; // 停止访问名单，JSON 格式
	ASSETS: Fetcher;
}

/**
 * 页面动作：命中规则后渲染哪个页面
 */
interface PageAction {
	/** 页面注册表中的 key */
	page: PageKey;
	/** 覆盖页面默认状态码，例如上游返回 524 */
	status?: number;
	/** 覆盖页面默认的是否通知 */
	notify?: boolean;
}

/**
 * 规则上下文：每个请求只构建一次，规则本身只做纯判断
 */
interface RuleContext {
	url: URL;
	hostname: string;
	blackList: string[];
	stopList: string[];
	isSystemPath: boolean;
}

interface Rule {
	/** 规则名，仅用于阅读和排查 */
	name: string;
	match: (context: RuleContext) => boolean;
	page: PageAction;
}

/** 这些路径不受黑名单/停止名单影响 */
const SYSTEM_PATH_PREFIXES = ['/.well-known/', '/__cfw_assets/'];

function parseList(raw: string | undefined, name: string): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			console.error(`${name} 不是数组，已忽略`);
			return [];
		}
		return parsed.map(String);
	} catch (e) {
		console.error(`Failed to parse ${name}:`, e);
		return [];
	}
}

function buildRuleContext(url: URL, env: Env): RuleContext {
	return {
		url,
		hostname: url.hostname.toLowerCase(),
		blackList: parseList(env.BLACK_LIST, 'BLACK_LIST'),
		stopList: parseList(env.STOP_LIST, 'STOP_LIST'),
		isSystemPath: SYSTEM_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)),
	};
}

/**
 * 前置规则表：按顺序匹配，命中即返回对应页面；全部不命中时走代理。
 * 新增一类拦截 / 测试入口时，只需要在这里加一条。
 */
const RULES: Rule[] = [
	{
		name: 'blacklist',
		match: (context) => !context.isSystemPath && context.blackList.includes(context.hostname),
		page: { page: 'error', status: 403, notify: false },
	},
	{
		name: 'stoplist',
		match: (context) => !context.isSystemPath && context.stopList.includes(context.hostname),
		page: { page: 'stopped' },
	},
	{
		name: 'test-mode',
		match: (context) => context.url.searchParams.get('testcfw') === '1',
		page: { page: 'error', status: 503, notify: false },
	},
];

async function respondPage(action: PageAction, request: Request, env: Env): Promise<Response> {
	const page = PAGES[action.page];
	const context = buildPageContext(request, action.status ?? page.status, env);
	const notify = action.notify ?? page.notify;

	if (notify && !context.url.href.endsWith('favicon.ico')) {
		context.reportId = (await sendTelegramReport(context, env)) ?? '无';
	}

	if (page.jsonForPlainUa && isPlainUa(context)) {
		return renderPlain(context);
	}

	return renderPage(page, context);
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			const url = new URL(request.url);
			const ruleContext = buildRuleContext(url, env);
			const rule = RULES.find((candidate) => candidate.match(ruleContext));

			if (rule) {
				return respondPage(rule.page, request, env);
			}

			// 未命中任何规则：代理请求到上游源站
			const response = await fetch(request);

			// 拦截 5xx 错误
			if (response.status >= 500) {
				return respondPage({ page: 'error', status: response.status }, request, env);
			}

			return response;
		} catch (e) {
			// 彻底断网时的兜底，默认给 522
			return respondPage({ page: 'error', status: 522 }, request, env);
		}
	},
} satisfies ExportedHandler<Env>;
