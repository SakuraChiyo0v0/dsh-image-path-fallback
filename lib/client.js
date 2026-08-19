window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-image-path-fallback",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		/**
		* @dsh-external/dsh-image-path-fallback — client 设置页开关。
		* 提供“图片自动降级为文件路径”的开关，通过 loopback RPC 读取/写入宿主状态。
		*/
		const inject = ["slots", "connection"];
		const RPC_CHANNEL = "/dsh-image-path-fallback";
		const RPC_GET = "imageFallback.get";
		const RPC_SET = "imageFallback.set";
		const styles = {
			card: {
				background: "var(--dsw-alias-bg-layer-1,#fff)",
				border: "1px solid var(--dsw-alias-border-l2,#e5e7eb)",
				borderRadius: 12,
				padding: "16px 20px",
				maxWidth: 520,
				display: "flex",
				flexDirection: "column",
				gap: 8
			},
			row: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 12,
				flexWrap: "wrap"
			},
			muted: {
				color: "var(--dsw-alias-label-tertiary,#8b93a1)",
				fontSize: 12,
				lineHeight: 1.5
			},
			primary: {
				font: "inherit",
				cursor: "pointer",
				border: "none",
				background: "var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary,#4f6ef7))",
				color: "#fff",
				height: 36,
				padding: "0 16px",
				borderRadius: 999,
				fontSize: 13
			}
		};
		function ImageFallbackSettings({ rpcCall }) {
			const [enabled, setEnabled] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let alive = true;
				const load = async () => {
					try {
						const value = await rpcCall(RPC_GET, {});
						if (alive) setEnabled(value.enabled);
					} catch (e) {
						if (alive) setError(e instanceof Error ? e.message : String(e));
					}
				};
				load();
				return () => {
					alive = false;
				};
			}, [rpcCall]);
			const toggle = async () => {
				if (enabled === null || busy) return;
				setBusy(true);
				setError(null);
				try {
					setEnabled((await rpcCall(RPC_SET, { enabled: !enabled })).enabled);
				} catch (e) {
					setError(e instanceof Error ? e.message : String(e));
				} finally {
					setBusy(false);
				}
			};
			return (0, react.createElement)("div", { style: styles.card }, (0, react.createElement)("strong", null, "🖼️ 图片自动降级为文件路径"), (0, react.createElement)("div", { style: styles.muted }, "当当前模型不支持图片时，自动把用户发送的图片保存为本地文件路径，并提示模型使用识图 skill 读取该文件。"), (0, react.createElement)("div", { style: styles.row }, (0, react.createElement)("span", null, enabled === null ? "读取中…" : enabled ? "✅ 已开启" : "⛔ 已关闭"), (0, react.createElement)("button", {
				style: styles.primary,
				disabled: enabled === null || busy,
				onClick: toggle
			}, busy ? "处理中…" : enabled ? "关闭" : "开启")), error ? (0, react.createElement)("div", { style: {
				color: "var(--dsw-alias-state-error-primary,#dc2626)",
				fontSize: 12
			} }, `❌ ${error}`) : null);
		}
		function apply(ctx) {
			const rpcCall = async (endpoint, payload) => {
				const res = await ctx.connection.rpc.call(RPC_CHANNEL, endpoint, payload);
				if (!res.ok || res.value === void 0) throw new Error(res.error?.message ?? "RPC failed");
				return res.value;
			};
			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-image-path-fallback",
				order: 50,
				label: () => "图片降级",
				inject: () => ({ rpcCall })
			}, ImageFallbackSettings)), "@dsh-external/dsh-image-path-fallback: settings section");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map