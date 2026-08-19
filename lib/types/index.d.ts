/**
 * @dsh-external/dsh-image-path-fallback
 *
 * 宿主侧插件：
 * 1. 包装 ctx.llm.resolveModelInfo，让不支持图片的模型在准入阶段“看起来支持图片”
 * 2. 监听 agent/pre-step，把 image block 替换成可自定义的文案；可选模式：仅给文件路径，
 *    或调用一个可识图模型的子代理分析图片后把结果文本注入主对话。
 * 3. 设置页开关与模板配置持久化到 ~/.dsh/dsh-image-path-fallback/settings.json。
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
