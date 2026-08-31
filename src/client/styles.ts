/** Browser stylesheet injected and removed with the client plugin fiber. */
export const LEARNING_VIEW_CSS = `
.dsh-explain-root{box-sizing:border-box;height:100%;min-height:0;width:100%;overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);padding:24px 24px calc(var(--dsh-composer-height,152px) + 32px)}
.dsh-explain-shell{width:min(900px,100%);margin:0 auto;display:flex;flex-direction:column;gap:20px}
.dsh-explain-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.dsh-explain-heading h1{font:var(--dsw-font-title-2);margin:0}
.dsh-explain-status{font:var(--dsw-font-xs-12);color:var(--dsw-alias-label-secondary);margin-top:6px}
.dsh-explain-error{padding:10px 12px;border:1px solid var(--dsw-alias-border-danger,var(--dsw-alias-border-l2));border-radius:10px;color:var(--dsw-alias-label-danger,var(--dsw-alias-label-primary));background:var(--dsw-alias-bg-layer-2);font:var(--dsw-font-xs-12);overflow-wrap:anywhere}
.dsh-explain-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.dsh-explain-metric{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.dsh-explain-metric strong{display:block;font:var(--dsw-font-title-3);font-variant-numeric:tabular-nums}
.dsh-explain-metric span{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dsh-explain-section{display:flex;flex-direction:column;gap:10px}
.dsh-explain-section-title{display:flex;align-items:center;gap:8px;margin:0;font:var(--dsw-font-title-3)}
.dsh-explain-count{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-explain-empty{padding:18px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-12);text-align:center}
.dsh-explain-context{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-explain-context-block{min-width:0}
.dsh-explain-context-block h3{margin:0 0 4px;font:var(--dsw-font-xs-12);color:var(--dsw-alias-label-secondary)}
.dsh-explain-context-block p{margin:0;font:var(--dsw-font-sm-14);white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-explain-context-wide{grid-column:1/-1}
.dsh-explain-preferences{display:flex;flex-wrap:wrap;gap:6px}
.dsh-explain-chip{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);font:var(--dsw-font-xxs-12)}
.dsh-explain-card{padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 1px 2px rgb(0 0 0/.04)}
.dsh-explain-card-active{border-color:var(--dsw-alias-border-focus,var(--dsw-alias-border-l2))}
.dsh-explain-card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dsh-explain-card h3{margin:0;font:var(--dsw-font-title-3)}
.dsh-explain-meta{display:flex;flex-wrap:wrap;gap:6px 10px;margin-top:5px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-explain-badge{flex:none;padding:3px 7px;border-radius:999px;background:var(--dsw-alias-bg-accent-subtle,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-label-accent,var(--dsw-alias-label-primary));font:var(--dsw-font-xxs-12)}
.dsh-explain-fields{display:grid;gap:10px;margin-top:14px}
.dsh-explain-field h4{margin:0 0 3px;font:var(--dsw-font-xs-12);color:var(--dsw-alias-label-secondary)}
.dsh-explain-field p{margin:0;font:var(--dsw-font-sm-14);line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-explain-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.dsh-explain-history{display:flex;flex-direction:column;gap:8px}
.dsh-explain-history-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.dsh-explain-history-main{min-width:0}
.dsh-explain-history-title{font:var(--dsw-font-sm-14);overflow-wrap:anywhere}
.dsh-explain-history-detail{margin-top:3px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-explain-history-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.dsh-explain-source-unavailable{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-explain-load{display:flex;justify-content:center;padding-top:4px}
.dsh-explain-settings{width:min(760px,100%);display:flex;flex-direction:column;gap:20px;padding-bottom:32px;color:var(--dsw-alias-label-primary)}
.dsh-explain-settings-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.dsh-explain-settings-heading h2{margin:0;font:var(--dsw-font-title-2)}
.dsh-explain-settings-heading p{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-sm-14);line-height:1.5}
.dsh-explain-settings-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-explain-toggle{grid-column:1/-1;display:flex;align-items:flex-start;gap:10px;cursor:pointer}
.dsh-explain-toggle input{margin-top:3px}
.dsh-explain-toggle span{display:flex;flex-direction:column;gap:3px}
.dsh-explain-toggle strong{font:var(--dsw-font-sm-14)}
.dsh-explain-toggle small,.dsh-explain-control small{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);line-height:1.4}
.dsh-explain-control{display:flex;flex-direction:column;gap:6px;font:var(--dsw-font-xs-12)}
.dsh-explain-control input,.dsh-explain-control select{box-sizing:border-box;width:100%;min-height:38px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:var(--dsw-font-sm-14)}
.dsh-explain-settings-actions{grid-column:1/-1;display:flex;align-items:center;gap:12px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-explain-data-management{display:flex;flex-direction:column;gap:12px}
.dsh-explain-data-management h3{margin:0;font:var(--dsw-font-title-3)}
.dsh-explain-data-management>div>p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-12);line-height:1.5}
.dsh-explain-notice{padding:10px 12px;border:1px solid var(--dsw-alias-border-success,var(--dsw-alias-border-l2));border-radius:10px;background:var(--dsw-alias-bg-layer-2);font:var(--dsw-font-xs-12)}
.dsh-explain-data-export{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-explain-data-export>div{display:flex;flex-direction:column;gap:4px}
.dsh-explain-data-export strong,.dsh-explain-danger-zone strong{font:var(--dsw-font-sm-14)}
.dsh-explain-data-export small,.dsh-explain-danger-zone small{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);line-height:1.45}
.dsh-explain-danger-zone{display:grid;grid-template-columns:minmax(0,1fr) minmax(190px,.55fr) auto;align-items:end;gap:14px;padding:14px;border:1px solid var(--dsw-alias-border-danger,var(--dsw-alias-border-l2));border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-explain-danger-zone>div:first-child{align-self:center}
.dsh-explain-danger-zone p{margin:4px 0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-12);line-height:1.45}
.dsh-explain-danger-button{min-height:34px;padding:7px 12px;border:1px solid var(--dsw-alias-border-danger,var(--dsw-alias-border-l2));border-radius:8px;color:var(--dsw-alias-label-danger,var(--dsw-alias-label-primary));background:transparent;font:var(--dsw-font-xs-12);cursor:pointer}
.dsh-explain-danger-button:hover:not(:disabled){background:var(--dsw-alias-bg-danger-subtle,var(--dsw-alias-bg-layer-3))}
.dsh-explain-danger-button:disabled{cursor:not-allowed;opacity:.45}
.dsh-explain-shortcut{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:0;border-radius:28px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-explain-shortcut:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dsh-explain-shortcut[data-unavailable]{cursor:default;opacity:.4}
.dsh-explain-shortcut[data-unavailable]:hover{background:transparent;color:var(--dsw-alias-label-tertiary)}
.dsh-explain-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dsh-explain-diagnostics{display:flex;flex-direction:column;gap:12px}
.dsh-explain-diagnostics h3{margin:0;font:var(--dsw-font-title-3)}
.dsh-explain-diagnostic-state{padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-accent-subtle,var(--dsw-alias-bg-layer-2));font:var(--dsw-font-sm-14)}
.dsh-explain-diagnostic-state[data-state="failed"]{color:var(--dsw-alias-label-danger,var(--dsw-alias-label-primary))}
.dsh-explain-diagnostics dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-border-l2)}
.dsh-explain-diagnostics dl>div{min-width:0;padding:10px 12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-explain-diagnostics dt{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-explain-diagnostics dd{margin:3px 0 0;overflow-wrap:anywhere;font:var(--dsw-font-sm-14)}
.dsh-explain-review{padding:16px;border:1px solid var(--dsw-alias-border-focus,var(--dsw-alias-border-l2));border-radius:14px;background:var(--dsw-alias-bg-layer-2)}
.dsh-explain-review-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.dsh-explain-review-intro{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-12);line-height:1.5}
.dsh-explain-review-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.dsh-explain-review-card{background:var(--dsw-alias-bg-layer-1)}
.dsh-explain-review-card .dsh-explain-badge{display:inline-flex;margin-bottom:6px}
.dsh-explain-review-question{margin:14px 0 10px;font:var(--dsw-font-sm-14);font-weight:600;line-height:1.55;white-space:pre-wrap}
.dsh-explain-review-answer{box-sizing:border-box;width:100%;min-height:110px;resize:vertical;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:var(--dsw-font-sm-14);line-height:1.5}
.dsh-explain-review-answer:focus{outline:2px solid var(--dsw-alias-border-focus,var(--dsw-alias-border-l2));outline-offset:1px}
.dsh-explain-review-recent{display:flex;flex-direction:column;gap:8px;margin-top:4px}
.dsh-explain-review-recent>h3{margin:0;font:var(--dsw-font-xs-12);color:var(--dsw-alias-label-secondary)}
.dsh-explain-review-result{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dsh-explain-review-result>div{display:flex;justify-content:space-between;gap:12px;font:var(--dsw-font-xs-12)}
.dsh-explain-review-result p{margin:6px 0;font:var(--dsw-font-xs-12);line-height:1.5}
.dsh-explain-review-result small{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-explain-review-result-footer{display:flex;align-items:center;justify-content:space-between;gap:10px}
.dsh-explain-review-verdict{flex:none}.dsh-explain-review-verdict-mastered{color:var(--dsw-alias-label-success,var(--dsw-alias-label-primary))}.dsh-explain-review-verdict-partial{color:var(--dsw-alias-label-warning,var(--dsw-alias-label-secondary))}.dsh-explain-review-verdict-forgotten{color:var(--dsw-alias-label-danger,var(--dsw-alias-label-primary))}
@media (max-width:720px){.dsh-explain-root{padding:16px 12px calc(var(--dsh-composer-height,152px) + 24px)}.dsh-explain-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.dsh-explain-context{grid-template-columns:1fr}.dsh-explain-context-wide{grid-column:auto}.dsh-explain-card-header{flex-direction:column}.dsh-explain-history-row{align-items:flex-start;flex-direction:column}.dsh-explain-history-actions{justify-content:flex-start}.dsh-explain-settings-form,.dsh-explain-diagnostics dl,.dsh-explain-danger-zone{grid-template-columns:1fr}.dsh-explain-settings-heading,.dsh-explain-data-export{align-items:flex-start;flex-direction:column}}
`
