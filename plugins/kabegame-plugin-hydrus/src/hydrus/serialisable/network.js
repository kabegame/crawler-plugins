// ClientNetworkingDomain.DomainMetadataPackage 与 HydrusNetworking.BandwidthRules 的序列化。
// downloader 导出包会带上按域名的自定义请求头和带宽规则。
import { load, register, T } from "./core.js";

// HydrusConstants.BANDWIDTH_TYPE_*
export const BANDWIDTH_TYPE_DATA = 0;
export const BANDWIDTH_TYPE_REQUESTS = 1;

register({
  type: T.BANDWIDTH_RULES,
  version: 1,
  // Python 侧存为 set：这里按首次出现去重；导出顺序在 hydrus 里本就不确定
  normalise: (rules) => {
    const seen = new Set();
    const out = [];
    for (const rule of rules) {
      const k = JSON.stringify(rule);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([...rule]);
    }
    return out;
  },
});

register({
  type: T.DOMAIN_METADATA_PACKAGE,
  version: 1,
  normalise: ([domain, headersList, bandwidthRules], ctx) => [
    domain,
    headersList,
    bandwidthRules === null ? null : load(bandwidthRules, ctx),
  ],
});
