/**
 * @name DiscordQuestLauncher
 * @author Suraj64x (original script), monbev (plugin)
 * @description Quest status filters, confirmed progress, estimated queue time and play/pause controls.
 * @version 1.0.1
 * @source https://github.com/monbev/DiscordQuestLauncher
 * @updateUrl https://raw.githubusercontent.com/monbev/DiscordQuestLauncher/main/DiscordQuestLauncher.plugin.js
 */
// SPDX-License-Identifier: GPL-3.0-only
// Based on Suraj64x/discordquest, retrieved 2026-10-02.
// Original quest algorithms with plugin lifecycle tracking. Updates require a user action.
const NAME = "DiscordQuestLauncher";
const PANEL_ID = "discord-quest-launcher-panel";
const FILTER_ID = "discord-quest-launcher-filters";
const PLUGIN_VERSION = "1.0.1";
const UPDATE_URL = "https://raw.githubusercontent.com/monbev/DiscordQuestLauncher/main/DiscordQuestLauncher.plugin.js";

function questAction(button) {
    const text = `${button.textContent || ""} ${button.getAttribute?.("aria-label") || ""}`
        .toLowerCase().replace(/\s+/g, " ").trim();
    if (/launch\s+quest|запустити\s+квест|запустить\s+квест/.test(text)) return "launch";
    if (/claim\s+reward|(?:забрати|отримати|получить|забрать)\s+(?:нагороду|нагороди|награду)/.test(text)) return "claim";
    if (/\bwatch\b|дивитися|переглянути|смотреть|посмотреть/.test(text)) return "watch";
    if (/\baccept\b|прийняти|принять/.test(text)) return "accept";
    if (/виберіть платформу,? щоб почати|выберите платформу|select (?:a )?platform|choose (?:a )?platform/.test(text)) return "accept";
    return null;
}
function cardCategory(buttons) {
    const actions = buttons.map(button => ({kind: questAction(button), enabled: !button.disabled && button.getAttribute?.("aria-disabled") !== "true"}));
    if (actions.some(action => action.kind === "claim")) return "claim";
    if (actions.some(action => action.kind === "launch")) return "other";
    if (actions.some(action => action.kind === "watch")) return "watch";
    if (actions.some(action => action.kind === "accept" && action.enabled)) return "accept";
    return "other";
}

function classifyQuestCard(card, quest) {
    // Inspect only the action area, not the trailer's Play icon or ad links.
    const actionArea = card.querySelector?.('[class*="container__960ef"]') || card;
    const buttons = [...actionArea.querySelectorAll('button, [role="button"]')];
    const category = cardCategory(buttons);
    if (category === "claim") return "claim";
    if (buttons.some(button => questAction(button) === "launch")) return "other";
    const status = quest?.userStatus ?? quest?.user_status;
    const knownStatus = !!quest && ("userStatus" in quest || "user_status" in quest || !!quest.config);
    if (status?.claimedAt || status?.claimed_at || status?.completedAt || status?.completed_at) return "other";
    const accepted = knownStatus ? !!(status?.enrolledAt || status?.enrolled_at)
        : !!card.querySelector?.('[role="progressbar"]');
    if (accepted) {
        const tasks = quest?.config?.taskConfig?.tasks ?? quest?.config?.taskConfigV2?.tasks ?? {};
        if (tasks.WATCH_VIDEO || tasks.WATCH_VIDEO_ON_MOBILE || category === "watch") return "watch";
        if (tasks.PLAY_ON_DESKTOP || tasks.STREAM_ON_DESKTOP || tasks.PLAY_ACTIVITY || category === "accept") return "play";
        // Recognize accepted game cards with only a game launch/download link.
        if (buttons.some(button => /\bplay\b|\bdownload\b|грати|грайте|завантажити|играть|скачать/i.test(button.textContent || ""))) return "play";
        return "other";
    }
    if (knownStatus) return category === "accept" ? "accept" : category === "watch" ? "watch" : "other";
    return category;
}

function findQuestCards() {
    const tiles = [...document.querySelectorAll('article[id^="quest-tile-"]')];
    if (tiles.length) return tiles;
    const candidates = new Set();
    for (const button of document.querySelectorAll('button, [role="button"]')) {
        if (button.closest(`#${FILTER_ID}, #${PANEL_ID}, [role="dialog"]`) || !questAction(button)) continue;
        let node = button.parentElement;
        while (node && node !== document.body) {
            const className = typeof node.className === "string" ? node.className : "";
            if (/(?:quest(?:Tile|Card)|(?:tile|card)(?:Container|Wrapper)?_)/i.test(className) || node.tagName === "ARTICLE") {
                candidates.add(node); break;
            }
            // Semantic fallback for builds with renamed CSS modules. Never use
            // a page/grid containing several quest actions as a single card.
            const actions = [...node.querySelectorAll('button, [role="button"]')].filter(questAction);
            if (actions.length === 1 && node.querySelector('h2, h3, [role="heading"]') && node.querySelector('img, video')) {
                candidates.add(node); break;
            }
            node = node.parentElement;
        }
    }
    return [...candidates].filter(card => ![...candidates].some(other => other !== card && other.contains(card)));
}
function questCardTarget(card) {
    const parent = card.parentElement;
    // Discord's grid contains one plain wrapper per article. Hide the grid
    // item so excluded articles leave no empty cells. Never hide the grid.
    if (card.id?.startsWith("quest-tile-") && parent && parent.children.length === 1 &&
        parent.children[0] === card && parent.parentElement?.style.getPropertyValue("--custom-min-quest-tile-width")) return parent;
    return card;
}
function cardInfo(card, quest) {
    const category = classifyQuestCard(card, quest);
    const status = quest?.userStatus ?? quest?.user_status;
    const tasks = quest?.config?.taskConfig?.tasks ?? quest?.config?.taskConfigV2?.tasks ?? {};
    const buttons = [...(card.querySelector?.('[class*="container__960ef"]') || card).querySelectorAll('button, [role="button"]')];
    const launch = buttons.some(button => questAction(button) === "launch");
    const enrolled = status ? !!(status.enrolledAt || status.enrolled_at) : !!card.querySelector?.('[role="progressbar"]');
    const done = !!(status?.completedAt || status?.completed_at || status?.claimedAt || status?.claimed_at);
    const type = tasks.WATCH_VIDEO || tasks.WATCH_VIDEO_ON_MOBILE || category === "watch" ? "video"
        : Object.keys(tasks).length || category === "play" ? "game"
        : /дивитися|відео|watch|video/i.test(card.querySelector?.('[class*="description__"]')?.textContent || "") ? "video" : "game";
    const state = category === "claim" ? "rewards" : launch || done ? "other"
        : enrolled ? "active" : category === "accept" || category === "watch" ? "new" : "other";
    return {state, type};
}
function formatSeconds(value) {
    const seconds = Math.max(0, Math.floor(value));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

class QuestSession {
    constructor(onFinish, onUpdate) {
        this.onFinish = onFinish; this.onUpdate = onUpdate; this.active = true;
        this.cleanups = new Set(); this.subscriptions = new Map(); this.failures = [];
        this.total = 0; this.remaining = 0; this.current = null;
        this.confirmed = new Set(); this.progress = null;
    }
    setQueue(quests) { this.pending = [...quests]; this.total = quests.length; this.remaining = quests.length; this.onUpdate(); }
    beginQuest(quest, remaining) {
        this.current = quest; this.remaining = remaining;
        this.pending = this.pending.filter(item => item.id !== quest.id);
        const tasks = quest.config.taskConfig?.tasks ?? quest.config.taskConfigV2?.tasks ?? {};
        this.task = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"].find(key => tasks[key]);
        this.target = tasks[this.task]?.target || 0;
        this.progress = null;
        this.lastAdvance = Date.now(); this.lastSignal = this.lastAdvance; this.frozenVisual = null;
        this.readProgress(quest.userStatus);
        this.onUpdate();
    }
    readProgress(status, live = false) {
        if (!this.current || !status) return;
        const now = Date.now(); const previous = this.progress;
        const value = status.progress?.[this.task]?.value ?? (this.current.config.configVersion === 1 ? status.streamProgressSeconds : undefined);
        if (Number.isFinite(value)) this.progress = Math.min(this.target, Math.max(this.progress ?? 0, value));
        if (status.completedAt || status.completed_at) {
            this.progress = this.target; this.confirmed.add(this.current.id);
        }
        if (this.progress !== previous) this.lastAdvance = now;
        if (live || this.progress !== previous) this.lastSignal = now;
        this.onUpdate();
    }
    visualProgress(now = Date.now()) {
        if (!this.active && this.frozenVisual) return this.frozenVisual;
        const limit = this.task === "WATCH_VIDEO" || this.task === "WATCH_VIDEO_ON_MOBILE" ? 20 : this.task === "PLAY_ACTIVITY" ? 60 : 90;
        const age = Math.max(0, (now - this.lastAdvance) / 1000);
        const waiting = this.active && age >= limit && !this.confirmed.has(this.current?.id);
        const confirmed = Number.isFinite(this.progress) ? this.progress : null;
        const extra = this.active && confirmed !== null ? Math.floor(Math.min(age, limit)) : 0;
        const estimated = confirmed === null ? null : Math.max(confirmed, Math.min(Math.max(0, this.target - 1), confirmed + extra));
        return {estimated, waiting, visualState: waiting ? (this.lastSignal > this.lastAdvance ? "Progress stalled" : "Waiting for update")
            : this.active && estimated >= this.target - 1 && !this.confirmed.has(this.current?.id) ? "Waiting for completion" : ""};
    }
    refreshProgress() {
        if (!this.active || !this.current) return;
        try {
            const store = BdApi.Webpack?.getStore?.("QuestsStore");
            const quest = store?.getQuest?.(this.current.id) ?? store?.quests?.get?.(this.current.id);
            this.readProgress(quest?.userStatus);
        } catch {}
    }
    estimatedSeconds() {
        if (!this.active) return 0;
        const remaining = quest => {
            const tasks = quest.config.taskConfig?.tasks ?? quest.config.taskConfigV2?.tasks ?? {};
            const task = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"].find(key => tasks[key]);
            const target = Number(tasks[task]?.target);
            if (!Number.isFinite(target)) return null;
            const status = quest.userStatus || {};
            const value = quest === this.current ? this.progress : status.progress?.[task]?.value ?? (quest.config.configVersion === 1 ? status.streamProgressSeconds : 0);
            return Math.max(0, target - (Number(value) || 0));
        };
        const values = [...(this.current ? [this.current] : []), ...(this.pending || [])].map(remaining);
        return values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
    }
    clearQuest() {
        for (const cleanup of this.cleanups) {
            try { cleanup(); } catch (failure) { console.error("[" + NAME + "] Cleanup:", failure); }
        }
        this.cleanups.clear(); this.subscriptions.clear();
    }
    failQuest(quest, error, next) {
        if (!this.active || this.current?.id !== quest.id) return;
        const name = quest.config?.messages?.questName || quest.id;
        const detail = String(error?.message || "Unknown error").slice(0, 180);
        this.failures.push({name, detail});
        console.error("[" + NAME + "] Skipping quest " + quest.id + ":", error);
        this.clearQuest(); this.onUpdate(); next();
    }
    cleanup(fn) { this.cleanups.add(fn); }
    sleep(ms) {
        return new Promise((resolve, reject) => {
            if (!this.active) return reject(new Error("Run stopped."));
            const cancel = () => { clearTimeout(timer); reject(new Error("Run stopped.")); };
            const timer = setTimeout(() => { this.cleanups.delete(cancel); resolve(); }, ms);
            this.cleanup(cancel);
        });
    }
    request(api, method, args) {
        return new Promise((resolve, reject) => {
            if (!this.active) return reject(new Error("Run stopped."));
            const cancel = () => reject(new Error("Run stopped.")); this.cleanup(cancel);
            Promise.resolve().then(() => {
                if (!this.active) throw new Error("Run stopped.");
                return api[method](...args);
            }).then(result => {
                this.cleanups.delete(cancel);
                if (this.active && this.current && args[0]?.url?.startsWith(`/quests/${this.current.id}/`)) this.readProgress(result?.body?.userStatus || result?.body, true);
                if (this.active) resolve(result); else reject(new Error("Run stopped."));
            }, error => { this.cleanups.delete(cancel); reject(error); });
        });
    }
    subscribe(dispatcher, event, fn, questId, onError) {
        const wrapped = data => {
            if (!this.active || (data?.questId != null && data.questId !== questId)) return;
            try { this.readProgress(data.userStatus, true); fn(data); } catch (error) { onError(error); }
        };
        const remove = () => dispatcher.unsubscribe(event, wrapped);
        this.subscriptions.set(fn, remove); this.cleanup(remove); dispatcher.subscribe(event, wrapped);
    }
    unsubscribe(dispatcher, event, fn) {
        const remove = this.subscriptions.get(fn);
        if (remove) { remove(); this.cleanups.delete(remove); this.subscriptions.delete(fn); }
    }
    finish(reason = "done", error) {
        if (!this.active) return;
        this.frozenVisual = this.visualProgress();
        this.active = false;
        this.clearQuest(); this.onFinish(reason, error);
    }
    fail(error) { this.finish("error", error); }
}

class ParallelSession {
    constructor(onFinish, onUpdate) {
        this.onFinish = onFinish; this.onUpdate = onUpdate;
        this.active = true; this.starting = true; this.children = []; this.results = [];
    }
    get total() { return this.children.reduce((sum, child) => sum + child.total, 0); }
    get failures() { return this.children.flatMap(child => child.failures); }
    get processed() {
        return this.children.reduce((sum, child) => sum + (!child.active ? child.total :
            child.current ? child.total - child.remaining - 1 : 0), 0);
    }
    get runningNames() {
        return this.children.filter(child => child.active && child.current)
            .map(child => `${child.lane}: ${child.current.config?.messages?.questName || child.current.id}`);
    }
    launch() {
        // Create both workers before starting either: synchronous empty/error
        // completion in one lane must not finish or cancel the other lane.
        for (const lane of ["Video", "Game / activity"]) {
            const child = new QuestSession((reason, error) => {
                this.results.push({reason, error});
                this.onUpdate(); this.checkFinished();
            }, () => this.onUpdate());
            child.lane = lane; this.children.push(child);
        }
        this.children.forEach((child, index) => {
            try { runOriginalScript(child, index === 0 ? "video" : "other"); }
            catch (error) { child.fail(error); }
        });
        this.starting = false; this.onUpdate(); this.checkFinished();
    }
    checkFinished() {
        if (!this.active || this.starting || this.children.some(child => child.active)) return;
        this.active = false;
        const error = this.results.find(result => result.error)?.error;
        this.onFinish(error ? "error" : this.total ? "done" : "empty", error);
    }
    finish(reason) {
        if (!this.active) return;
        this.finalEstimate = this.estimatedSeconds();
        this.active = false;
        for (const child of this.children) child.finish("stopped");
        this.onFinish(reason);
    }
    estimatedSeconds() {
        if (!this.active && this.finalEstimate !== undefined) return this.finalEstimate;
        const values = this.children.map(child => child.estimatedSeconds());
        return values.some(value => value === null) ? null : Math.max(0, ...values);
    }
}

module.exports = class DiscordQuestLauncher {
    start() {
        if (this.enabled) return;
        this.enabled = true;
        this.updateOwner = {}; this.updateCandidate = null; this.updateChecking = false; this.updateWriting = false;
        this.checkPluginUpdate();
        this.updateCheckTimer = setInterval(() => this.checkPluginUpdate(), 4 * 60 * 60 * 1000);
        this.uiSettings = {state: (BdApi.Data?.load(NAME, "uiSettings") || {}).state || "all"};
        if (!["all", "new", "active", "rewards"].includes(this.uiSettings.state)) this.uiSettings.state = "all";
        this.noticeSettings = this.loadNoticeSettings();
        this.noticeHistory = BdApi.Data?.load(NAME, "noticeHistory") || {};
        this.noticeCards = new Map(); this.systemNotices = new Map(); this.rewardHints = new Set();
        this.noticeVisibilityListener = () => this.checkNotices();
        document.addEventListener?.("visibilitychange", this.noticeVisibilityListener);
        this.restartNoticeChecks(); this.checkNotices();
        BdApi.DOM.addStyle(NAME, `
            #${PANEL_ID} { position: fixed; bottom: 24px; right: 24px; z-index: 100;
                display: flex; align-items: center; gap: 8px; }
            #${PANEL_ID} .dql-progress { padding: 6px 10px; border-radius: 8px;
                background: var(--background-floating, #232428); color: var(--text-normal, #fff);
                font: 600 13px/1.4 var(--font-primary, sans-serif); font-variant-numeric: tabular-nums;
                box-shadow: 0 2px 8px #0003; }
            #${PANEL_ID} .dql-progress[hidden] { display: none; }
            #${PANEL_ID} .dql-progress { width: 280px; font-weight: 400; }
            #${PANEL_ID} .dql-eta { color: var(--text-muted); font-size: 12px; margin-top: 4px; }
            #${PANEL_ID} .dql-progress-row { margin-top: 8px; }
            #${PANEL_ID} .dql-track { position: relative; height: 6px; border-radius: 4px; overflow: hidden; margin-top: 5px; background: var(--background-modifier-accent,#454550); }
            #${PANEL_ID} .dql-track span { position: absolute; inset: 0 auto 0 0; transition: width .8s linear; border-radius: inherit; }
            #${PANEL_ID} .dql-track .dql-estimated { background: var(--brand-500,#5865f2); opacity: .4; }
            #${PANEL_ID} .dql-track .dql-confirmed { background: var(--brand-500,#5865f2); }
            #${PANEL_ID} .dql-progress-row[data-waiting="true"] { color: var(--status-warning,#f0b232); }
            #${PANEL_ID} .dql-progress-row[data-waiting="true"] .dql-track span { background: var(--status-warning,#f0b232); }
            #${PANEL_ID} .dql-state { font-size: 11px; margin-top: 3px; }
            #${PANEL_ID} button { display: grid; place-items: center; width: 44px; height: 44px;
                background: var(--background-floating, #232428); color: var(--text-normal, #fff);
                border: 1px solid var(--background-modifier-accent, #454550); border-radius: 12px;
                padding: 0; cursor: pointer; box-shadow: 0 4px 16px #0004;
                transition: background .15s, transform .15s; }
            #${PANEL_ID} button[data-state="pause"] { background: var(--brand-500, #5865f2); color: #fff; border-color: transparent; }
            #${PANEL_ID} button:hover { background: var(--brand-600, #4752c4); color: #fff; transform: translateY(-1px); }
            #${PANEL_ID} button svg { width: 20px; height: 20px; pointer-events: none; }
            #${PANEL_ID} button:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
            [data-dql-heading="true"] { flex-wrap: wrap; gap: 12px; }
            #${FILTER_ID} { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto;
                padding: 0; background: transparent; }
            #${FILTER_ID} button { padding: 7px 10px; border: 0; border-radius: 7px; cursor: pointer;
                font: 13px/1.4 var(--font-primary, sans-serif); color: var(--text-normal, #fff); background: transparent; }
            #${FILTER_ID} button { border-radius: 0; border-bottom: 2px solid transparent; }
            #${FILTER_ID} button[aria-pressed="true"] { border-bottom-color: var(--brand-500, #5865f2); color: var(--text-normal, #fff); }
            #${FILTER_ID} select { background: var(--background-floating, #232428); color: var(--text-normal, #fff); border: 0; border-radius: 6px; padding: 6px; }
            #${FILTER_ID} button:focus-visible { outline: 2px solid var(--brand-500, #5865f2); }
            [data-dql-filter-hidden="true"] { display: none !important; }
            #dql-reminders { position:fixed; top:48px; right:20px; z-index:1001; display:flex; flex-direction:column; gap:12px; width:min(360px,calc(100vw - 48px)); max-height:calc(100vh - 72px); overflow:auto; }
            #dql-reminders .dql-notice { position:relative; overflow:hidden; padding:16px; border-radius:12px; border:1px solid var(--background-modifier-accent,#454550); background:var(--background-floating,#232428); color:var(--text-normal,#fff); box-shadow:0 6px 24px #0005; font:14px/1.5 var(--font-primary,sans-serif); }
            #dql-reminders .dql-source, .dql-reward-hint .dql-source { color:var(--text-muted,#b5bac1); font-size:11px; margin-bottom:5px; }
            #dql-reminders .dql-notice-title { font-weight:600; font-size:16px; }
            #dql-reminders .dql-notice-copy { color:var(--text-muted,#b5bac1); margin-top:5px; overflow-wrap:anywhere; }
            #dql-reminders .dql-notice-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
            #dql-reminders button { padding:7px 10px; border:0; border-radius:6px; background:var(--background-modifier-accent,#454550); color:inherit; cursor:pointer; font:inherit; font-size:12px; }
            #dql-reminders button:first-child { background:var(--brand-500,#5865f2); color:#fff; }
            #dql-reminders button:focus-visible { outline:2px solid var(--brand-500,#5865f2); outline-offset:2px; }
            #dql-reminders .dql-notice-title { padding-right:24px; }
            #dql-reminders .dql-close { position:absolute; top:8px; right:8px; background:transparent; padding:3px 7px; font-size:18px; }
            #dql-reminders .dql-lifetime { height:3px; position:absolute; bottom:0; left:0; right:0; background:var(--background-modifier-accent,#454550); }
            #dql-reminders .dql-lifetime span { display:block; height:100%; background:var(--brand-500,#5865f2); transform-origin:left; transition:transform .1s linear; }
            @media (prefers-reduced-motion:reduce) { #dql-reminders .dql-lifetime span { transition:none; } }
            .dql-reward-hint { padding:12px; margin-top:16px; border-radius:8px; background:var(--background-secondary,#232428); border-left:3px solid var(--brand-500,#5865f2); color:var(--text-normal,#fff); font:13px/1.5 var(--font-primary,sans-serif); }
        `);
        this.observer = new MutationObserver(() => this.scheduleRender());
        this.observer.observe(document.body, {childList: true, subtree: true});
        this.routeListener = () => this.scheduleRender();
        window.addEventListener("popstate", this.routeListener);
        this.routeTimer = setInterval(() => { this.session?.children.forEach(child => child.refreshProgress()); this.render(); }, 1000);
        this.render();
    }
    onSwitch() { this.scheduleRender(); }
    scheduleRender() {
        if (!this.enabled || this.renderTimer != null) return;
        this.renderTimer = setTimeout(() => { this.renderTimer = null; this.render(); }, 50);
    }
    isQuestsPage() { return /(?:^|\/)(?:quest-home|quests)(?:\/|$)/.test(window.location.pathname); }
    render() {
        if (!this.enabled) return;
        try {
            const userStore = BdApi.Webpack?.getStore?.("UserStore");
            if (userStore?.getCurrentUser && (userStore.getCurrentUser()?.id || null) !== (this.noticeAccount || null)) this.checkNotices();
        } catch {}
        this.inspectRewardModals(); this.renderNotices();
        if (!this.isQuestsPage()) {
            this.panel?.remove(); this.panel = null;
            this.filterBar?.remove(); this.filterBar = null; this.restoreCards(); return;
        }
        this.renderFilters();
        if (!this.panel?.isConnected) {
            document.getElementById(PANEL_ID)?.remove();
            const panel = document.createElement("div"); panel.id = PANEL_ID;
            panel.setAttribute("role", "region"); panel.setAttribute("aria-label", "Quest progress");
            this.progress = document.createElement("span"); this.progress.className = "dql-progress";
            this.progressSummary = null; this.progressSignature = null;
            this.progress.setAttribute("role", "status"); this.progress.setAttribute("aria-live", "polite");
            this.button = document.createElement("button"); this.button.type = "button";
            this.button.addEventListener("click", () => this.toggleExecution());
            panel.append(this.progress, this.button); document.body.append(panel); this.panel = panel;
        }
        const running = !!this.session?.active;
        const session = this.session;
        const currentName = session?.runningNames.join("\n") || "Quests";
        const counter = running && session.total ? `${session.processed}/${session.total}` : "";
        this.renderProgress(session);
        this.progress.title = currentName;
        this.progress.setAttribute("aria-label", counter ? `Processed ${session.processed} of ${session.total}. ${currentName}` : "");
        const label = running ? `${counter}\n${currentName}${session.failures.length ? ` · failed: ${session.failures.length}` : ""}` : (this.lastResult || "Accepted quests");
        const state = running ? "pause" : "play";
        if (this.button.dataset.state !== state) {
            this.button.dataset.state = state;
            this.button.innerHTML = running
                ? '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
                : '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5.5a1 1 0 0 1 1.5-.86l10 6.5a1 1 0 0 1 0 1.72l-10 6.5A1 1 0 0 1 8 18.5z"/></svg>';
        }
        const action = running ? "Pause quests" : "Start quests";
        this.button.setAttribute("aria-label", action);
        this.button.setAttribute("aria-pressed", String(running));
        this.button.disabled = false;
        const detail = running ? session.failures.map(item => item.name + ": " + item.detail).join("\n") : this.lastDetail;
        this.button.title = [action, label, detail].filter(Boolean).join("\n");
    }
    toggleExecution() {
        if (!this.enabled) return;
        if (this.session?.active) this.session.finish("paused");
        else this.execute();
    }
    renderProgress(session) {
        const rows = session?.children.filter(child => child.current).map(child => ({lane: child.lane,
            name: child.current.config.messages?.questName || child.current.id, target: child.target,
            value: child.progress, active: child.active, confirmed: child.confirmed.has(child.current.id), ...child.visualProgress()})) || this.lastProgress || [];
        const title = session?.active ? `Processed ${session.processed} of ${session.total}` : this.lastResult || "";
        this.progress.hidden = !title;
        const seconds = session?.active ? session.estimatedSeconds() : this.lastETA;
        const etaText = seconds == null ? "Estimated time unavailable" : seconds > 0 ? `About ${Math.ceil(seconds / 60)} min remaining` : "Waiting for confirmation";
        const signature = JSON.stringify({title, rows, etaText});
        if (signature === this.progressSignature && this.progress.children.length) return;
        this.progressSignature = signature;
        // Keep progress DOM stable between ticks so CSS transitions can run.
        if (!this.progressSummary) {
            this.progress.replaceChildren();
            this.progressSummary = document.createElement("div"); this.progress.append(this.progressSummary);
            this.progressETA = document.createElement("div"); this.progressETA.className = "dql-eta"; this.progress.append(this.progressETA);
            this.progressRows = document.createElement("div"); this.progress.append(this.progressRows);
            this.rowNodes = new Map();
        }
        this.progressSummary.textContent = title;
        this.progressETA.hidden = !(session?.active || this.lastResult?.startsWith("Paused"));
        this.progressETA.textContent = etaText;
        this.progressETA.title = "Estimate based on remaining quest durations. Server delays and manual streaming can increase the wait.";
        for (const [lane, nodes] of this.rowNodes) if (!rows.some(row => row.lane === lane)) { nodes.line.remove(); this.rowNodes.delete(lane); }
        for (const row of rows) {
            let nodes = this.rowNodes.get(row.lane);
            if (!nodes) {
                const line = document.createElement("div"); line.className = "dql-progress-row";
                const text = document.createElement("div"), track = document.createElement("div"), estimated = document.createElement("span"), confirmed = document.createElement("span"), state = document.createElement("div");
                track.className = "dql-track"; estimated.className = "dql-estimated"; confirmed.className = "dql-confirmed"; state.className = "dql-state";
                track.setAttribute("role", "progressbar"); track.append(estimated, confirmed); line.append(text, track, state); this.progressRows.append(line);
                nodes = {line, text, track, estimated, confirmed, state}; this.rowNodes.set(row.lane, nodes);
            }
            const {line, text, track, estimated, confirmed, state} = nodes;
            line.title = `${row.name}\nConfirmed: ${row.value === null ? "unknown" : formatSeconds(row.value)}. Light segment and ~ timer are estimated.`;
            line.setAttribute("data-waiting", String(!!row.waiting));
            const value = Number.isFinite(row.estimated) ? `${row.estimated > row.value ? "~" : ""}${formatSeconds(row.estimated)} / ${formatSeconds(row.target)}` : "Waiting for progress";
            text.textContent = `${row.lane} · ${value}${row.confirmed ? " ✓" : ""}`;
            estimated.style.width = `${100 * (row.estimated || 0) / (row.target || 1)}%`;
            confirmed.style.width = `${100 * (row.value || 0) / (row.target || 1)}%`;
            track.setAttribute("aria-label", `${row.name}: confirmed progress`); track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", String(row.target));
            if (row.value !== null) track.setAttribute("aria-valuenow", String(row.value)); else track.removeAttribute("aria-valuenow");
            state.textContent = row.visualState || ""; state.hidden = !row.visualState;
        }
    }
    saveUI() { BdApi.Data?.save(NAME, "uiSettings", this.uiSettings); }
    restoreCards() {
        for (const card of this.filteredCards || []) card.removeAttribute("data-dql-filter-hidden");
        this.filteredCards = new Set();
        this.filterHeading?.removeAttribute("data-dql-heading"); this.filterHeading = null;
    }
    questForCard(card) {
        const id = card.id?.replace(/^quest-tile-/, "");
        if (!id) return;
        try {
            this.filterQuestStore ||= BdApi.Webpack?.getStore?.("QuestsStore") ||
                BdApi.Webpack?.getModule?.(item => !!item?.quests && typeof item.getQuest === "function", {searchExports: true});
            return this.filterQuestStore?.getQuest?.(id) ?? this.filterQuestStore?.quests?.get?.(id);
        } catch { return undefined; }
    }
    loadNoticeSettings() {
        const saved = BdApi.Data?.load(NAME, "noticeSettings") || {};
        const clamp = (key, fallback, min, max) => Math.min(max, Math.max(min, Number(saved[key]) || fallback));
        // Explicit fields discard obsolete reward reminder settings.
        return {newQuests: saved.newQuests !== false, windows: !!saved.windows, pauseHover: saved.pauseHover !== false,
            sound: saved.sound !== false, volume: Math.min(100, Math.max(0, Number.isFinite(Number(saved.volume)) ? Number(saved.volume) : 25)),
            displaySeconds: clamp("displaySeconds", 12, 1, 300), checkSeconds: clamp("checkSeconds", 180, 5, 3600), snoozeHours: clamp("snoozeHours", 1, 1, 720)};
    }
    restartNoticeChecks() {
        clearInterval(this.noticeTimer);
        if (this.enabled) this.noticeTimer = setInterval(() => this.checkNotices(), this.noticeSettings.checkSeconds * 1000);
    }
    checkNotices(now = Date.now()) {
        if (!this.enabled) return;
        try {
            const user = BdApi.Webpack?.getStore?.("UserStore")?.getCurrentUser?.();
            if (!user?.id) { this.noticeAccount = null; this.noticeSnapshot = null; this.renderNotices(now); return; }
            this.noticeAccount = user.id;
            const store = BdApi.Webpack?.getStore?.("QuestsStore") || this.filterQuestStore;
            const list = [...(store?.quests?.values?.() || [])];
            if (!list.length) { this.noticeSnapshot = null; this.renderNotices(now); return; }
            const history = this.noticeHistory[user.id] ||= {initialized: false, seen: {}};
            const before = JSON.stringify(history);
            delete history.rewards; delete history.rewardNotices;
            history.newQuests ||= {pending: {}, dismissed: {}, snoozeUntil: 0};
            const fresh = history.newQuests; fresh.shown ||= {};
            const available = {};
            for (const quest of list) {
                if (!quest?.id || !quest.config) continue;
                const status = quest.userStatus || quest.user_status || {};
                const tasks = (quest.config.taskConfig ?? quest.config.taskConfigV2)?.tasks;
                const supported = ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY"].some(task => tasks?.[task]);
                const eligible = supported && !(status.enrolledAt || status.enrolled_at || status.completedAt || status.completed_at || status.claimedAt || status.claimed_at) && Date.parse(quest.config.expiresAt) > now;
                const name = quest.config.messages?.questName || quest.config.application?.name || quest.id;
                if (eligible) available[quest.id] = name;
                if (!history.seen[quest.id]) {
                    history.seen[quest.id] = now;
                    if (history.initialized && eligible) fresh.pending[quest.id] = name;
                }
            }
            for (const id of Object.keys(fresh.pending)) if (!available[id]) delete fresh.pending[id];
            history.initialized = true; this.noticeSnapshot = {history};
            if (JSON.stringify(history) !== before) this.saveNoticeHistory();
            this.renderNotices(now);
        } catch (error) { console.error("[" + NAME + "] Notifications:", error); }
    }
    saveNoticeHistory() { BdApi.Data?.save(NAME, "noticeHistory", this.noticeHistory); }
    notifyQuests(title, names) {
        this.closeNotice("test"); this.testNotice = {title, copy: names.join(" · ")}; this.renderNotices();
        this.playNoticeSound();
    }
    async playNoticeSound() {
        if (!this.enabled || !this.noticeSettings.sound || !this.noticeSettings.volume) return;
        try {
            const Audio = window.AudioContext || window.webkitAudioContext;
            if (!Audio) return;
            const audio = this.audioContext ||= new Audio();
            if (audio.state === "suspended") await audio.resume();
            if (!this.enabled || audio.state === "closed" || !this.noticeSettings.sound) return;
            const start = audio.currentTime;
            // A short, quiet sine chime with soft attack/release. No downloads.
            for (const [frequency, offset] of [[523.25, 0], [659.25, 0.12]]) {
                const oscillator = audio.createOscillator(); const gain = audio.createGain();
                oscillator.type = "sine"; oscillator.frequency.setValueAtTime(frequency, start + offset);
                gain.gain.setValueAtTime(0.0001, start + offset);
                gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.12 * this.noticeSettings.volume / 100), start + offset + 0.025);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.3);
                oscillator.connect(gain); gain.connect(audio.destination);
                oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
                oscillator.start(start + offset); oscillator.stop(start + offset + 0.32);
            }
        } catch (error) { console.error("[" + NAME + "] Notification sound:", error); }
    }
    inspectRewardModals() {
        for (const modal of document.querySelectorAll('[data-mana-component="modal"], [role="dialog"]')) {
            const title = modal.querySelector('h1, h2, [role="heading"]')?.textContent || "";
            if (!/reward error|помилка винагороди|ошибка награды/i.test(title)) continue;
            const body = modal.querySelector('main[class*="bodyInner"], main, [class*="bodyInner"]');
            if (!body || body.querySelector('.dql-reward-hint')) continue;
            const hint = document.createElement("aside"); hint.className = "dql-reward-hint";
            const label = document.createElement("div"); label.className = "dql-source"; label.textContent = "Tip from DiscordQuestLauncher";
            const copy = document.createElement("div"); copy.textContent = "Having trouble claiming? Try claiming this reward from another Discord session, such as your browser or phone.";
            hint.append(label, copy); body.append(hint); this.rewardHints.add(hint);
        }
        for (const hint of this.rewardHints) if (!hint.isConnected) this.rewardHints.delete(hint);
    }
    closeNotice(kind) {
        const card = this.noticeCards?.get(kind);
        if (card) { clearTimeout(card.timer); card.node.remove(); this.noticeCards.delete(kind); }
        if (kind === "test") this.testNotice = null;
        this.systemNotices?.get(kind)?.notification.close(); this.systemNotices?.delete(kind);
        if (!this.noticeCards?.size) {
            this.noticeStack?.remove(); this.noticeStack = null;
            clearInterval(this.noticeAnimationTimer); this.noticeAnimationTimer = null;
        }
    }
    reminderAction(action, now = Date.now()) {
        const state = this.noticeSnapshot?.history.newQuests;
        if (!state) return;
        if (action === "snooze") {
            state.snoozeUntil = now + this.noticeSettings.snoozeHours * 3600000;
            // Visible quests return after snooze; already expired notices stay read.
            for (const id of this.noticeCards.get("new")?.ids || []) delete state.shown[id];
        } else {
            const visible = this.noticeCards.get("new")?.ids || [];
            for (const id of Object.keys(state.pending)) if (!state.shown[id] || visible.includes(id)) state.dismissed[id] = now;
        }
        this.saveNoticeHistory(); this.closeNotice("new"); this.renderNotices(now);
    }
    resetNoticeClock(card, now) {
        clearTimeout(card.timer); card.duration = this.noticeSettings.displaySeconds * 1000;
        card.remaining = card.duration; card.deadline = now + card.remaining;
        if (!card.pauses.size) card.timer = setTimeout(() => { this.closeNotice(card.kind); this.renderNotices(); }, card.remaining);
        this.paintNoticeClock(card, now);
    }
    pauseNotice(card, reason, pause, now = Date.now()) {
        if (pause && reason !== "window" && !this.noticeSettings.pauseHover || this.noticeCards.get(card.kind) !== card) return;
        if (pause) {
            if (!card.pauses.size) { card.remaining = Math.max(0, card.deadline - now); clearTimeout(card.timer); }
            card.pauses.add(reason);
        } else {
            const wasPaused = card.pauses.size; card.pauses.delete(reason);
            if (wasPaused && !card.pauses.size) {
                card.deadline = now + card.remaining;
                card.timer = setTimeout(() => { this.closeNotice(card.kind); this.renderNotices(); }, card.remaining);
            }
        }
        this.paintNoticeClock(card, now);
    }
    paintNoticeClock(card, now = Date.now()) {
        const remaining = card.pauses.size ? card.remaining : Math.max(0, card.deadline - now);
        const transform = "scaleX(" + Math.min(1, remaining / card.duration) + ")";
        if (card.bar.style.transform !== transform) card.bar.style.transform = transform;
    }
    renderNotices(now = Date.now()) {
        if (!this.enabled || !this.noticeCards) return;
        const desired = new Map(); const state = this.noticeSnapshot?.history.newQuests;
        const active = this.noticeCards.get("new");
        if (state && this.noticeSettings.newQuests && state.snoozeUntil <= now) {
            const ids = Object.keys(state.pending).filter(id => !state.dismissed[id] && (!state.shown[id] || active?.account === this.noticeAccount && active.ids.includes(id)));
            if (ids.length) desired.set("new", {ids, title: ids.length + (ids.length === 1 ? " new quest" : " new quests"),
                copy: ids.slice(0, 3).map(id => state.pending[id]).join(" · ") + (ids.length > 3 ? "…" : "")});
        }
        if (this.testNotice) desired.set("test", {ids: [], ...this.testNotice});
        for (const [kind, card] of this.noticeCards) if (!desired.has(kind) || card.account !== this.noticeAccount) this.closeNotice(kind);
        for (const [kind, data] of desired) {
            let card = this.noticeCards.get(kind);
            const hiddenWindow = document.visibilityState === "hidden";
            // Keep arrivals pending until the user can see the card. Do not
            // consume its lifetime, mark it shown or play an invisible alert.
            if (!card && hiddenWindow) continue;
            if (card) this.pauseNotice(card, "window", hiddenWindow, now);
            if (hiddenWindow) continue;
            if (!card) {
                if (!this.noticeStack?.isConnected) { this.noticeStack = document.createElement("div"); this.noticeStack.id = "dql-reminders"; document.body.append(this.noticeStack); }
                const node = document.createElement("section"); node.className = "dql-notice"; node.setAttribute("aria-label", "DiscordQuestLauncher notification");
                const label = document.createElement("div"); label.className = "dql-source"; label.textContent = NAME;
                const title = document.createElement("div"); title.className = "dql-notice-title"; title.setAttribute("role", "status"); title.setAttribute("aria-live", "polite");
                const copy = document.createElement("div"); copy.className = "dql-notice-copy";
                const actions = document.createElement("div"); actions.className = "dql-notice-actions";
                const help = document.createElement("div"); help.className = "dql-notice-copy";
                help.textContent = "Open Quests in Discord to view the new quests.";
                if (kind === "new") {
                    const snooze = document.createElement("button"); snooze.type = "button";
                    snooze.addEventListener("click", () => this.reminderAction("snooze")); actions.append(snooze);
                    const dismiss = document.createElement("button"); dismiss.type = "button"; dismiss.textContent = "Dismiss current";
                    dismiss.addEventListener("click", () => this.reminderAction("dismiss")); actions.append(dismiss);
                }
                const close = document.createElement("button"); close.type = "button"; close.className = "dql-close"; close.textContent = "×"; close.setAttribute("aria-label", "Close notification");
                close.addEventListener("click", () => { if (kind === "new") this.reminderAction("dismiss"); else { this.closeNotice(kind); this.renderNotices(); } });
                const track = document.createElement("div"); track.className = "dql-lifetime"; track.setAttribute("aria-hidden", "true"); const bar = document.createElement("span"); track.append(bar);
                node.append(label, title, copy, help, actions, close, track); this.noticeStack.append(node);
                card = {node, title, copy, actions, bar, kind, ids: [], pauses: new Set(), account: this.noticeAccount}; this.noticeCards.set(kind, card);
                node.addEventListener("mouseenter", () => this.pauseNotice(card, "hover", true)); node.addEventListener("mouseleave", () => this.pauseNotice(card, "hover", false));
                node.addEventListener("focusin", () => this.pauseNotice(card, "focus", true));
                node.addEventListener("focusout", event => { if (!node.contains?.(event.relatedTarget)) this.pauseNotice(card, "focus", false); });
                this.resetNoticeClock(card, now);
            }
            const unseen = kind === "new" ? data.ids.filter(id => !state.shown[id]) : [];
            if (unseen.length) {
                for (const id of unseen) state.shown[id] = now;
                this.saveNoticeHistory(); this.resetNoticeClock(card, now);
                this.playNoticeSound();
                if (this.noticeSettings.windows && typeof Notification !== "undefined" && Notification.permission === "granted") {
                    state.systemSeen ||= {};
                    if (unseen.some(id => !state.systemSeen[id])) try {
                        this.systemNotices.get(kind)?.notification.close();
                        const notification = new Notification(NAME, {body: data.title + "\nOpen Quests in Discord to view them.", tag: NAME + "-new"});
                        this.systemNotices.set(kind, {notification});
                        for (const id of unseen) state.systemSeen[id] = now; this.saveNoticeHistory();
                    } catch (error) { console.error("[" + NAME + "] Windows notification:", error); }
                }
            }
            card.ids = data.ids;
            if (card.title.textContent !== data.title) card.title.textContent = data.title;
            if (card.copy.textContent !== data.copy) card.copy.textContent = data.copy;
            if (kind === "new") { const label = "Snooze " + this.noticeSettings.snoozeHours + "h"; if (card.actions.children[0].textContent !== label) card.actions.children[0].textContent = label; }
            this.paintNoticeClock(card, now);
        }
        if (this.noticeCards.size && !this.noticeAnimationTimer) this.noticeAnimationTimer = setInterval(() => {
            for (const card of this.noticeCards.values()) this.paintNoticeClock(card);
        }, 100);
    }
    getSettingsPanel() {
        this.noticeSettings ||= this.loadNoticeSettings();
        const panel = document.createElement("div"); panel.className = "dql-settings";
        panel.style.cssText = "padding:24px;color:var(--text-normal);font:14px/1.5 var(--font-primary,sans-serif);max-width:680px";
        const section = (title, description) => {
            const box = document.createElement("section");
            box.style.cssText = "padding:18px;margin:0 0 16px;border-radius:12px;background:var(--background-secondary,#232428);border:1px solid var(--background-modifier-accent,#454550)";
            const heading = document.createElement("h3"); heading.textContent = title; heading.style.cssText = "margin:0 0 6px;font-size:16px;font-weight:600";
            const help = document.createElement("p"); help.textContent = description; help.style.cssText = "margin:0 0 16px;color:var(--text-muted);font-size:13px";
            box.append(heading, help); panel.append(box); return box;
        };
        const save = () => {
            BdApi.Data?.save(NAME, "noticeSettings", this.noticeSettings);
            if (!this.noticeSettings.pauseHover) for (const card of this.noticeCards?.values() || [])
                for (const reason of [...card.pauses]) if (reason !== "window") this.pauseNotice(card, reason, false);
            this.restartNoticeChecks(); this.checkNotices();
        };
        const notices = section("Notifications", "Checks run while Discord is open, using quest data loaded by Discord. Existing quests are silently remembered on first use.");
        for (const [key, title, description] of [
            ["newQuests", "New quests", "Notify once for each new supported quest; exclude Launch Quest."],
            ["pauseHover", "Pause countdown on hover or keyboard focus", "Keep the notification readable while you interact with it."],
            ["sound", "Notification sound", "Play a soft two-note chime when a new quest notification appears."],
            ["windows", "Windows notifications", "Also use system notifications when permission is already granted."]]) {
            const row = document.createElement("label"); row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 0;border-top:1px solid var(--background-modifier-accent,#454550);cursor:pointer";
            const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = title;
            const help = document.createElement("div"); help.textContent = description; help.style.cssText = "color:var(--text-muted);font-size:12px;margin-top:3px"; copy.append(name, help);
            const input = document.createElement("input"); input.type = "checkbox"; input.checked = this.noticeSettings[key];
            input.style.cssText = "width:20px;height:20px;accent-color:var(--brand-500,#5865f2);flex-shrink:0";
            input.addEventListener("change", () => { this.noticeSettings[key] = input.checked; save(); });
            row.append(copy, input); notices.append(row);
        }
        const volumeRow = document.createElement("label"); volumeRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0";
        const volumeLabel = document.createElement("span"); volumeLabel.textContent = "Sound volume";
        const volume = document.createElement("input"); volume.type = "range"; volume.min = "0"; volume.max = "100"; volume.value = this.noticeSettings.volume;
        volume.setAttribute("aria-label", "Notification sound volume"); volume.style.cssText = "width:160px;accent-color:var(--brand-500,#5865f2)";
        const volumeValue = document.createElement("span"); volumeValue.textContent = this.noticeSettings.volume + "%";
        volume.addEventListener("input", () => { this.noticeSettings.volume = Number(volume.value); volumeValue.textContent = volume.value + "%"; BdApi.Data?.save(NAME, "noticeSettings", this.noticeSettings); });
        volumeRow.append(volumeLabel, volume, volumeValue); notices.append(volumeRow);
        const timing = section("Notification timing", "Top-right notifications close automatically. Display duration applies to the next notification. Check interval reads Discord's loaded quest data; it does not fetch new data from the server.");
        for (const [key, title, unit, min, max] of [["displaySeconds", "Display duration", "seconds", 1, 300], ["checkSeconds", "Check for new quests every", "seconds", 5, 3600], ["snoozeHours", "Snooze duration", "hours", 1, 720]]) {
            const row = document.createElement("label"); row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:16px;margin:12px 0";
            const name = document.createElement("span"); name.textContent = title;
            const controls = document.createElement("div"); controls.style.cssText = "display:flex;align-items:center;gap:8px";
            const input = document.createElement("input"); input.type = "number"; input.min = String(min); input.max = String(max); input.value = this.noticeSettings[key];
            input.style.cssText = "width:76px;padding:8px;border-radius:6px;border:1px solid var(--background-modifier-accent,#454550);background:var(--background-tertiary,#18191c);color:var(--text-normal)";
            input.addEventListener("change", () => { this.noticeSettings[key] = Math.min(max, Math.max(min, Number(input.value) || min)); input.value = this.noticeSettings[key]; save(); });
            controls.append(input, document.createTextNode(unit)); row.append(name, controls); timing.append(row);
        }
        const testSection = section("Test notifications", "Preview the countdown and hover pause without changing your quest notification history.");
        const test = document.createElement("button"); test.type = "button"; test.textContent = "Send test notification";
        test.style.cssText = "padding:10px 16px;border:0;border-radius:8px;background:var(--brand-500,#5865f2);color:white;font:inherit;cursor:pointer";
        test.addEventListener("click", () => this.notifyQuests("Test notification", ["Notifications are working. This is a test, not a new quest."])); testSection.append(test);
        const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "Reset snooze and dismissals";
        reset.style.cssText = test.style.cssText + ";margin-left:8px;background:var(--background-modifier-accent,#454550);color:var(--text-normal)";
        reset.addEventListener("click", () => {
            const state = this.noticeSnapshot?.history.newQuests; if (!state) return;
            state.snoozeUntil = 0;
            for (const id of Object.keys(state.dismissed)) delete state.shown[id];
            state.dismissed = {}; this.saveNoticeHistory(); this.checkNotices();
        }); timing.append(reset);
        return panel;
    }
    renderFilters() {
        const heading = document.querySelector('[class*="headingWrapper__57454"]') ||
            [...document.querySelectorAll('[class*="headingWrapper"]')].find(node => /доступні квести|available quests|доступные задания/i.test(node.querySelector('h2')?.textContent || ""));
        if (!heading) { this.filterBar?.remove(); this.filterBar = null; this.restoreCards(); return; }
        if (!this.filterBar?.isConnected) {
            document.getElementById(FILTER_ID)?.remove();
            const bar = document.createElement("div"); bar.id = FILTER_ID;
            bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Quest filters");
            this.filterButtons = new Map();
            for (const [key, label] of [["all", "All"], ["new", "New"], ["active", "In progress"], ["rewards", "Rewards"]]) {
                const button = document.createElement("button"); button.type = "button";
                button.addEventListener("click", () => { this.uiSettings.state = key; this.saveUI(); this.renderFilters(); });
                this.filterButtons.set(key, {button, label}); bar.append(button);
            }
            const controls = heading.querySelector?.('[class*="headingControls"]');
            if (controls) heading.insertBefore(bar, controls); else heading.append(bar);
            this.filterBar = bar;
        }
        if (this.filterBar.parentElement !== heading && this.filterBar.parent !== heading) heading.append(this.filterBar);
        if (this.filterHeading !== heading) {
            this.filterHeading?.removeAttribute("data-dql-heading"); this.filterHeading = heading;
        }
        if (heading.getAttribute("data-dql-heading") !== "true") heading.setAttribute("data-dql-heading", "true");
        const cards = findQuestCards();
        const live = new Set(cards.map(questCardTarget));
        for (const card of this.filteredCards || []) if (!live.has(card)) card.removeAttribute("data-dql-filter-hidden");
        this.filteredCards = live;
        const counts = {all: 0, new: 0, active: 0, rewards: 0};
        for (const card of cards) {
            const target = questCardTarget(card);
            const info = cardInfo(card, this.questForCard(card));
            counts.all++; if (info.state in counts) counts[info.state]++;
            const hide = this.uiSettings.state !== "all" && this.uiSettings.state !== info.state;
            if (hide && target.getAttribute("data-dql-filter-hidden") !== "true") target.setAttribute("data-dql-filter-hidden", "true");
            if (!hide && target.hasAttribute("data-dql-filter-hidden")) target.removeAttribute("data-dql-filter-hidden");
        }
        for (const [key, {button, label}] of this.filterButtons) {
            const text = `${label} (${counts[key]})`;
            if (button.textContent !== text) button.textContent = text;
            const pressed = String(this.uiSettings.state === key);
            if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
            button.title = key === "new" ? "Not accepted yet; excludes Launch Quest" :
                cards.length ? "Display filter only. Play runs all accepted quests." : "Quest cards are not loaded or their layout is not recognized.";
        }
    }
    execute() {
        if (!this.enabled || this.session?.active) return;
        this.lastResult = ""; this.lastDetail = "";
        const session = new ParallelSession((reason, error) => {
            if (this.session !== session) return;
            const failures = session.failures.length;
            this.lastETA = session.estimatedSeconds();
            this.lastProgress = session.children.filter(child => child.current).map(child => ({lane: child.lane,
                name: child.current.config.messages?.questName || child.current.id, target: child.target,
                value: child.progress, active: false, confirmed: child.confirmed.has(child.current.id), ...child.visualProgress()}));
            const confirmed = session.children.reduce((sum, child) => sum + child.confirmed.size, 0);
            this.lastDetail = session.failures.map(item => item.name + ": " + item.detail).join("\n");
            this.lastResult = error ? "Stopped: " + String(error.message || "unknown error").slice(0, 180)
                : reason === "empty" ? "No accepted quests found"
                : reason === "stopped" ? "Stopped"
                : reason === "paused" ? "Paused. Press play to resume."
                : `Confirmed ${confirmed} of ${session.total} · failed: ${failures}${session.total - confirmed - failures > 0 ? " · remaining quests await confirmation" : ""}`;
            this.session = null; this.render();
            if (reason === "stopped" || reason === "paused") return;
            if (error) console.error("[" + NAME + "] Quest script:", error);
            const messages = {empty: "No accepted incomplete quests.", done: "Queue processed. Check your rewards in Discord.",
                error: "DiscordQuest: execution error. See the Discord console.", desktop: "This quest requires the official Discord desktop app."};
            messages.done = this.lastResult + ". Check your rewards in Discord.";
            const message = failures ? `Queue processed. Failed quests: ${failures}. Hover over the control for details.` : (messages[reason] || messages.done);
            BdApi.UI.showToast(message, {type: reason === "error" || failures ? "error" : "info"});
        }, () => this.render());
        this.session = session; this.render();
        session.launch();
    }
    async checkPluginUpdate() {
        if (!this.enabled || this.updateChecking || this.updateWriting || !BdApi.Net?.fetch || !BdApi.UI?.showNotification) return;
        const owner = this.updateOwner; this.updateChecking = true;
        try {
            const response = await BdApi.Net.fetch(UPDATE_URL, {timeout: 10000});
            if (!response.ok) throw new Error(`Update check HTTP ${response.status}`);
            const source = await response.text();
            if (!this.enabled || this.updateOwner !== owner) return;
            const header = source.match(/^\s*\/\*\*[\s\S]*?\*\//)?.[0] || "";
            const name = header.match(/@name\s+([^\r\n]+)/)?.[1]?.trim();
            const version = header.match(/@version\s+(\d+\.\d+\.\d+)\s*(?:\r?\n|\*\/)/)?.[1];
            if (name !== NAME || !version || !source.includes("module.exports")) throw new Error("Invalid plugin update file");
            const incoming = version.split(".").map(Number), installed = PLUGIN_VERSION.split(".").map(Number);
            const difference = incoming.map((value, index) => value - installed[index]).find(value => value !== 0) || 0;
            if (difference <= 0 || this.updateCandidate?.version === version) return;
            // Compile for syntax validation without running the downloaded code.
            new Function(source);
            this.updateNotification?.close?.();
            this.updateCandidate = {version, source};
            this.updateNotification = BdApi.UI.showNotification({
                title: "DiscordQuestLauncher Update Available",
                content: `Version ${version} is available. Update now? Active quests will finish before installation.`,
                duration: Infinity,
                actions: [{label: "Update", onClick: () => this.requestPluginUpdate()},
                    {label: "Later", onClick: () => this.updateNotification?.close?.()}]
            });
        } catch (error) {
            if (this.enabled && this.updateOwner === owner) console.error(`[${NAME}] Update check:`, error);
        } finally { if (this.updateOwner === owner) this.updateChecking = false; }
    }
    requestPluginUpdate() {
        if (!this.enabled || !this.updateCandidate || this.updateWriting || this.updateWaitTimer) return;
        if (this.session?.active) {
            BdApi.UI.showToast("Update will install when the current quest run ends.", {type: "info"});
            this.updateWaitTimer = setInterval(() => {
                if (!this.session?.active) { clearInterval(this.updateWaitTimer); this.updateWaitTimer = null; this.installPluginUpdate(); }
            }, 1000);
        } else this.installPluginUpdate();
    }
    async installPluginUpdate() {
        if (!this.enabled || this.session?.active || !this.updateCandidate || this.updateWriting) return;
        const owner = this.updateOwner, candidate = this.updateCandidate; this.updateWriting = true;
        try {
            const folder = BdApi.Plugins?.folder;
            if (!folder) throw new Error("BetterDiscord plugins folder unavailable");
            const fs = require("fs"), path = require("path");
            // Replace only this plugin, without creating a backup file.
            await fs.promises.writeFile(path.join(folder, `${NAME}.plugin.js`), candidate.source, "utf8");
            if (!this.enabled || this.updateOwner !== owner) return;
            this.updateNotification?.close?.(); this.updateCandidate = null;
            BdApi.UI.showToast(`DiscordQuestLauncher updated to ${candidate.version}.`, {type: "success"});
        } catch (error) {
            if (this.enabled && this.updateOwner === owner) {
                console.error(`[${NAME}] Update installation:`, error);
                BdApi.UI.showToast("Update failed. Try again or download the plugin from GitHub.", {type: "error"});
            }
        } finally { if (this.updateOwner === owner) this.updateWriting = false; }
    }
    stop() {
        this.enabled = false;
        this.updateOwner = null; clearInterval(this.updateCheckTimer); clearInterval(this.updateWaitTimer);
        this.updateCheckTimer = null; this.updateWaitTimer = null; this.updateNotification?.close?.();
        this.updateNotification = null; this.updateCandidate = null;
        document.removeEventListener?.("visibilitychange", this.noticeVisibilityListener);
        this.noticeVisibilityListener = null;
        if (this.audioContext) { this.audioContext.close().catch(() => {}); this.audioContext = null; }
        for (const kind of [...(this.noticeCards?.keys() || [])]) this.closeNotice(kind);
        clearInterval(this.noticeAnimationTimer); this.noticeAnimationTimer = null;
        for (const notice of this.systemNotices?.values() || []) notice.notification.close(); this.systemNotices?.clear();
        this.testNotice = null; this.noticeSnapshot = null;
        for (const hint of this.rewardHints || []) hint.remove(); this.rewardHints?.clear();
        clearInterval(this.noticeTimer); this.noticeTimer = null;
        this.observer?.disconnect(); this.observer = null;
        window.removeEventListener("popstate", this.routeListener);
        clearInterval(this.routeTimer); clearTimeout(this.renderTimer); this.renderTimer = null;
        this.session?.finish("stopped"); this.session = null;
        this.panel?.remove(); this.panel = null;
        this.filterBar?.remove(); this.filterBar = null; this.restoreCards();
        BdApi.DOM.removeStyle(NAME);
    }
};
module.exports.filters = {questAction, cardCategory, classifyQuestCard, cardInfo, findQuestCards, questCardTarget};

function runOriginalScript(session, lane) {
let wpRequire = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
webpackChunkdiscord_app.pop();

let ApplicationStreamingStore = Object.values(wpRequire.c).find(x => x?.exports?.A?.__proto__?.getStreamerActiveStreamMetadata).exports.A;
let RunningGameStore = Object.values(wpRequire.c).find(x => x?.exports?.Ay?.getRunningGames).exports.Ay;
let QuestsStore = Object.values(wpRequire.c).find(x => x?.exports?.A?.__proto__?.getQuest).exports.A;
let ChannelStore = Object.values(wpRequire.c).find(x => x?.exports?.A?.__proto__?.getAllThreadsForParent).exports.A;
let GuildChannelStore = Object.values(wpRequire.c).find(x => x?.exports?.Ay?.getSFWDefaultChannel).exports.Ay;
let FluxDispatcher = Object.values(wpRequire.c).find(x => x?.exports?.h?.__proto__?.flushWaitQueue).exports.h;
let originalApi = Object.values(wpRequire.c).find(x => x?.exports?.Bo?.get).exports.Bo;

const api = {get: (...args) => session.request(originalApi, "get", args), post: (...args) => session.request(originalApi, "post", args)};

const supportedTasks = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"]
let quests = [...QuestsStore.quests.values()].filter(x => x.userStatus?.enrolledAt && !x.userStatus?.completedAt && new Date(x.config.expiresAt).getTime() > Date.now() && supportedTasks.find(y => Object.keys((x.config.taskConfig ?? x.config.taskConfigV2).tasks).includes(y)) &&
    ((lane === "video") === ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE"].includes(supportedTasks.find(y => Object.keys((x.config.taskConfig ?? x.config.taskConfigV2).tasks).includes(y)))))
let isApp = typeof DiscordNative !== "undefined"

session.setQueue(quests);
if(quests.length === 0) {
	console.log("You don't have any uncompleted quests!"); session.finish("empty");
} else {
	let doJob = function() {
		if(!session.active) return;
		session.clearQuest();
		const quest = quests.pop()
		if(!quest) { session.finish(); return; }
		session.beginQuest(quest, quests.length);
		try {

		const pid = Math.floor(Math.random() * 30000) + 1000
		
		const questName = quest.config.messages.questName
		const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2
		const taskName = supportedTasks.find(x => taskConfig.tasks[x] != null)
		const taskData = taskConfig.tasks[taskName]
		const applicationId = quest.config.application?.id ?? taskData.applications?.[0]?.id
		const secondsNeeded = taskData.target
		let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0

		if(taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
			const speed = 7
			const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime()
			let completed = false
			let fn = async () => {			
				while(true) {
					const remaining = Math.min(speed, secondsNeeded - secondsDone)
					await session.sleep(remaining * 1000)

					const timestamp = secondsDone + speed
					const res = await api.post({url: `/quests/${quest.id}/video-progress`, body: {timestamp: Math.min(secondsNeeded, timestamp + Math.random())}})
					completed = res.body.completed_at != null
					secondsDone = Math.min(secondsNeeded, timestamp)

					if(timestamp >= secondsNeeded) {
						break
					}
				}
				if(!completed) {
					await api.post({url: `/quests/${quest.id}/video-progress`, body: {timestamp: secondsNeeded}})
				}
				console.log("Quest completed!")
				doJob()
			}
			fn().catch(error => session.failQuest(quest, error, doJob))
			console.log(`Spoofing video for ${questName}.`)
		} else if(taskName === "PLAY_ON_DESKTOP") {
			if(!isApp) {
				console.log("This no longer works in browser for non-video quests. Use the discord desktop app to complete the", questName, "quest!"); session.finish("desktop");
			} else {
				api.get({url: `/applications/public?application_ids=${applicationId}`}).then(res => {
					const appData = res.body[0]
					const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">","") ?? appData.name.replace(/[\/\\:*?"<>|]/g, "")
					
					const fakeGame = {
						cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
						exeName,
						exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
						hidden: false,
						isLauncher: false,
						id: applicationId,
						name: appData.name,
						pid: pid,
						pidPath: [pid],
						processName: appData.name,
						start: Date.now(),
					}
					const realGames = RunningGameStore.getRunningGames()
					const fakeGames = [fakeGame]
					const realGetRunningGames = RunningGameStore.getRunningGames
					const realGetGameForPID = RunningGameStore.getGameForPID
                    session.cleanup(() => {
                        if (RunningGameStore.getRunningGames === realGetRunningGames) return;
                        RunningGameStore.getRunningGames = realGetRunningGames;
                        RunningGameStore.getGameForPID = realGetGameForPID;
                        FluxDispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: realGames, games: realGames});
                    });
					RunningGameStore.getRunningGames = () => fakeGames
					RunningGameStore.getGameForPID = (pid) => fakeGames.find(x => x.pid === pid)
					FluxDispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames})
					
					let fn = data => {
					if (!session.active) return;
						let progress = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.PLAY_ON_DESKTOP.value)
						console.log(`Quest progress: ${progress}/${secondsNeeded}`)
						
						if(progress >= secondsNeeded) {
							console.log("Quest completed!")
							
							RunningGameStore.getRunningGames = realGetRunningGames
							RunningGameStore.getGameForPID = realGetGameForPID
							FluxDispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: []})
							session.unsubscribe(FluxDispatcher, "QUESTS_SEND_HEARTBEAT_SUCCESS", fn)
							
							doJob()
						}
					}
					session.subscribe(FluxDispatcher, "QUESTS_SEND_HEARTBEAT_SUCCESS", fn, quest.id, error => session.failQuest(quest, error, doJob))
					
					console.log(`Spoofed your game to ${appData.name}. Wait for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`)
				}).catch(error => session.failQuest(quest, error, doJob))
			}
		} else if(taskName === "STREAM_ON_DESKTOP") {
			if(!isApp) {
				console.log("This no longer works in browser for non-video quests. Use the discord desktop app to complete the", questName, "quest!"); session.finish("desktop");
			} else {
				let realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata
                session.cleanup(() => { ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc; });
				ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
					id: applicationId,
					pid,
					sourceName: null
				})
				
				let fn = data => {
					if (!session.active) return;
					let progress = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.STREAM_ON_DESKTOP.value)
					console.log(`Quest progress: ${progress}/${secondsNeeded}`)
					
					if(progress >= secondsNeeded) {
						console.log("Quest completed!")
						
						ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc
						session.unsubscribe(FluxDispatcher, "QUESTS_SEND_HEARTBEAT_SUCCESS", fn)
						
						doJob()
					}
				}
				session.subscribe(FluxDispatcher, "QUESTS_SEND_HEARTBEAT_SUCCESS", fn, quest.id, error => session.failQuest(quest, error, doJob))
				
				console.log(`Spoofed your stream to the target game. Stream any window in vc for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`)
				console.log("Remember that you need at least 1 other person to be in the vc!")
			}
		} else if(taskName === "PLAY_ACTIVITY") {
			const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id ?? Object.values(GuildChannelStore.getAllGuilds()).find(x => x != null && x.VOCAL.length > 0).VOCAL[0].channel.id
			const streamKey = `call:${channelId}:1`
			
			let fn = async () => {
				console.log("Completing quest", questName, "-", quest.config.messages.questName)
				
				while(true) {
					const res = await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: false}})
					const progress = res.body.progress.PLAY_ACTIVITY.value
					console.log(`Quest progress: ${progress}/${secondsNeeded}`)
					
					await session.sleep(20 * 1000)
					
					if(progress >= secondsNeeded) {
						await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: true}})
						break
					}
				}
				
				console.log("Quest completed!")
				doJob()
			}
			fn().catch(error => session.failQuest(quest, error, doJob))
		}
		} catch(error) { session.failQuest(quest, error, doJob); }
	}
	doJob()
}
}
