// hydrus 发请求时的请求头与带宽规则（ClientNetworkingJobs._SendRequestAndGetResponse、
// NetworkDomainManager.GetHeaders、BandwidthManager）。
//
// 请求头按以下顺序叠加，后者覆盖前者：
//   1. 各 network context 的自定义头：全局默认（ClientDefaults）→ 每个适用域名（downloader 包里的 domain metadata）
//   2. URL class 的 header overrides
//   3. referer：由 URL class 的 send_referral_url 规则决定
// hydrus 对文件 URL 还会带 Range 做断点续传，下载由宿主完成，这里不发。
import { infoOf, T } from "../serialisable/core.js";
import { BANDWIDTH_TYPE_REQUESTS } from "../serialisable/network.js";
import { convert, StringConvertError } from "./strings.js";
import { normaliseUrl, parseUrl } from "./url.js";

/** ClientDefaults.DEFAULT_USER_AGENT 等全局默认头 */
export const DEFAULT_GLOBAL_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; Hydrus Client)",
  Accept: "image/jpeg,image/png,image/*;q=0.9,*/*;q=0.8",
  "Cache-Control": "no-transform",
};

// ClientDefaults.SetDefaultBandwidthManagerRules 中与请求数相关的规则：[type, time_delta 秒, max]
const DEFAULT_GLOBAL_RULES = [[BANDWIDTH_TYPE_REQUESTS, 1, 5]];
const DEFAULT_DOMAIN_RULES = [[BANDWIDTH_TYPE_REQUESTS, 1, 1]];

const SEND_REFERRAL_URL_ONLY_IF_PROVIDED = 0;
const SEND_REFERRAL_URL_NEVER = 1;
const SEND_REFERRAL_URL_CONVERTER_IF_NONE_PROVIDED = 2;
const SEND_REFERRAL_URL_ONLY_CONVERTER = 3;

// tldextract 的近似：常见的「二级 + 国家顶级域」公共后缀
const MULTI_LABEL_SUFFIX_SECOND = new Set(["co", "com", "net", "org", "ac", "gov", "edu", "ne", "or", "go"]);

/** ConvertDomainIntoSecondLevelDomain（近似 tldextract） */
export function secondLevelDomain(domain) {
  const labels = domain.split(".");
  if (labels.length <= 2) return domain;
  const last = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const n = last.length === 2 && MULTI_LABEL_SUFFIX_SECOND.has(second) ? 3 : 2;
  return labels.slice(-n).join(".");
}

/** ConvertDomainIntoAllApplicableDomains(domain, discard_www=True)：从具体到二级域。 */
export function applicableDomains(domain) {
  if (!domain.includes(".") || /^[\d.:]+$/.test(domain)) return [domain];
  const sld = secondLevelDomain(domain);
  // RemoveWWWFromDomain
  if (domain !== sld && domain.split(".").length > 2 && domain.startsWith("www")) domain = domain.slice(domain.indexOf(".") + 1);
  const out = [];
  while (domain.includes(".")) {
    out.push(domain);
    if (domain === sld) break;
    domain = domain.slice(domain.indexOf(".") + 1);
  }
  return out;
}

function hostOf(url) {
  const p = parseUrl(url);
  return p ? p.netloc.replace(/^.*@/, "").replace(/:\d+$/, "").toLowerCase() : "";
}

/** 把 BANDWIDTH_RULES 元组读成规则数组；null 表示没有设置。 */
function readRules(tuple) {
  return tuple === null ? null : infoOf(tuple).map(([type, timeDelta, max]) => [type, timeDelta, max]);
}

export class NetworkRules {
  /**
   * @param {{ domainPackages: any[], urlClassFor: (url: string) => any }} options
   *   domainPackages：升级后的 DOMAIN_METADATA_PACKAGE 元组
   */
  constructor({ domainPackages, urlClassFor }) {
    this.urlClassFor = urlClassFor;
    /** 域名 → { headers: [k, v][], rules: [...] | null } */
    this.domains = new Map();
    for (const pkg of domainPackages) {
      if (pkg[0] !== T.DOMAIN_METADATA_PACKAGE) continue;
      const [domain, headersList, bandwidthRules] = infoOf(pkg);
      this.domains.set(domain.toLowerCase(), {
        headers: (headersList ?? []).map(([k, v]) => [k, v]),
        rules: readRules(bandwidthRules),
      });
    }
    /** context → 请求时间戳（毫秒）*/
    this.usage = new Map();
  }

  /** NetworkDomainManager.GetHeaders(network_contexts) */
  contextHeaders(url) {
    const headers = { ...DEFAULT_GLOBAL_HEADERS };
    for (const domain of applicableDomains(hostOf(url))) {
      for (const [k, v] of this.domains.get(domain)?.headers ?? []) headers[k] = v;
    }
    return headers;
  }

  /** URLClass.GetReferralURL */
  referralUrl(urlClass, url, referralUrl) {
    if (!urlClass) return referralUrl;
    switch (urlClass.sendReferralUrl) {
      case SEND_REFERRAL_URL_ONLY_IF_PROVIDED:
        return referralUrl;
      case SEND_REFERRAL_URL_NEVER:
        return null;
      case SEND_REFERRAL_URL_CONVERTER_IF_NONE_PROVIDED:
      case SEND_REFERRAL_URL_ONLY_CONVERTER: {
        let converted;
        try {
          converted = convert(urlClass.referralUrlConverter, normaliseUrl(urlClass, url, true));
        } catch (e) {
          if (e instanceof StringConvertError) return referralUrl;
          throw e;
        }
        const onlyConverter = urlClass.sendReferralUrl === SEND_REFERRAL_URL_ONLY_CONVERTER;
        return onlyConverter || referralUrl === null ? converted : referralUrl;
      }
      default:
        return referralUrl;
    }
  }

  /**
   * 一次请求的完整请求头。
   * @param {string} url
   * @param {string | null} referralUrl  hydrus 里的「来源页」：列表页、上一页或详情页
   */
  headersFor(url, referralUrl) {
    const headers = this.contextHeaders(url);
    const urlClass = this.urlClassFor(url);
    if (urlClass) for (const [k, v] of urlClass.headerOverrides) headers[k] = v;
    const referer = this.referralUrl(urlClass, url, referralUrl);
    if (referer !== null && referer !== undefined) headers.Referer = referer;
    return headers;
  }

  /** 该 URL 涉及的 network context 及各自的请求数规则。 */
  contextsFor(url) {
    const out = [{ key: "global", rules: DEFAULT_GLOBAL_RULES }];
    for (const domain of applicableDomains(hostOf(url))) {
      out.push({ key: `domain:${domain}`, rules: this.domains.get(domain)?.rules ?? DEFAULT_DOMAIN_RULES });
    }
    return out;
  }

  /**
   * BandwidthManager.CanDoWork + ReportRequestUsed：等到所有 context 的请求数规则都允许，再记一次请求。
   * 数据量规则需要知道下载字节数，由宿主下载，这里不执行。
   */
  async waitForBandwidth(url, sleep) {
    const contexts = this.contextsFor(url);
    for (;;) {
      const now = Date.now();
      let waitMs = 0;
      for (const { key, rules } of contexts) {
        const times = this.usage.get(key) ?? [];
        for (const [type, timeDelta, max] of rules) {
          if (type !== BANDWIDTH_TYPE_REQUESTS) continue;
          const windowStart = timeDelta === null ? -Infinity : now - timeDelta * 1000;
          const inWindow = times.filter((t) => t > windowStart);
          if (inWindow.length >= max) {
            // 最早那次请求滑出窗口时才能再发
            waitMs = Math.max(waitMs, timeDelta === null ? Infinity : inWindow[inWindow.length - max] + timeDelta * 1000 - now + 1);
          }
        }
      }
      if (waitMs === Infinity) throw new Error(`带宽规则已不允许再请求 ${url}`);
      if (waitMs <= 0) break;
      await sleep(waitMs);
    }
    const now = Date.now();
    for (const { key, rules } of contexts) {
      const longest = Math.max(0, ...rules.filter((r) => r[0] === BANDWIDTH_TYPE_REQUESTS).map((r) => (r[1] === null ? Infinity : r[1])));
      const times = (this.usage.get(key) ?? []).filter((t) => longest === Infinity || t > now - longest * 1000);
      times.push(now);
      this.usage.set(key, times);
    }
  }

  /** 日志用：规则里有、但这里不执行的数据量规则 */
  describeIgnoredDataRules() {
    const out = [];
    for (const [domain, { rules }] of this.domains) {
      for (const [type, timeDelta, max] of rules ?? []) if (type !== BANDWIDTH_TYPE_REQUESTS) out.push(`${domain}: ${max} 字节 / ${timeDelta ?? "∞"} 秒`);
    }
    return out;
  }
}
