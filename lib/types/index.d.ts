/**
 * @dsh-external/dsh-image-path-fallback
 *
 * 宿主侧插件：
 * 1. 包装 ctx.llm.resolveModelInfo，让不支持图片的模型在准入阶段“看起来支持图片”
 *    （否则核心 api-proxy 会在入口直接拒绝）。
 * 2. 监听 agent/pre-step，在真实模型调用前把 image block 替换成“图片文件路径 + 提示”，
 *    让纯文本模型也能借助识图 skill 读取图片。
 * 3. 提供设置页开关，持久化到 ~/.dsh/dsh-image-path-fallback/settings.json。
 */
import type { Context } from 'cordis';
import z from 'schemastery';
export declare const name = "@dsh-external/dsh-image-path-fallback";
export declare const inject: string[];
export interface Config {
    enabled: boolean;
}
export declare const Config: z<Schemastery.ObjectS<{
    enabled: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    enabled: z<boolean, boolean>;
}>>;
export declare function apply(ctx: Context, _config: Config): void;
