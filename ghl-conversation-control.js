(() => {
  "use strict";

  const VERSION = "1.3.0";
  const INSTANCE_KEY = "__hgConversationControlInstance";

  if (window[INSTANCE_KEY]?.destroy) {
    window[INSTANCE_KEY].destroy();
  }

  const CONFIG = Object.freeze({
    tags: Object.freeze({
      open: "open",
      closed: "closed",
    }),
    labels: Object.freeze({
      open: "Open",
      close: "Close",
      opening: "Opening...",
      closing: "Closing...",
      closed: "Closed",
    }),
    tooltips: Object.freeze({
      open: "Open and take this conversation",
      close: "Close and finish this conversation",
      closed: "This conversation is closed",
    }),
    timing: Object.freeze({
      reconcileDebounceMs: 80,
      elementTimeoutMs: 8000,
      ownerTimeoutMs: 10000,
      tagTimeoutMs: 12000,
      errorHintMs: 6000,
    }),
  });

  const SELECTORS = Object.freeze({
    conversationsRoot: "#conversations-wrapper",
    conversationsPanel: "#conversations-panel",
    activeConversationCard:
      '[data-conversation-id][data-is-active="true"]',
    composerInput: '[id^="composer-input-"]',
    contactName: '[data-testid="CENTRALPANEL_NAME"]',
    sla: 'button#sla-badge-trigger[data-testid="CENTRALPANEL_SLA_BADGE"]',
    call: "button#call-stevo-btn",
    nativeHeaderActions:
      "#chat-filter, #phone-calls, #archive-conversation, #star-toggle, #read-toggle, #delete-conversation",

    details: "#conversations-contact-details",
    detailsBody: "#record-details-lhs",
    detailsContactLink: 'a[href*="/contacts/detail/"]',
    panelClose: "button#close-panel-button",
    panelOpenIcon: "#sidebar-contact-icon",

    ownerTrigger: "button#owner-dropdown-trigger",
    ownerLabel: "#owner-dropdown-trigger-label",
    ownerMenu:
      '#owner-dropdown-menu[role="menu"][data-hr-dropdown-trigger="owner-dropdown-trigger"]',
    ownerSearch:
      '#owner-dropdown-menu input[role="searchbox"][aria-controls="owner-dropdown-menu"]',
    ownerOptions: '#owner-dropdown-menu [role="menuitem"]',

    tagsTrigger: "button#add-tag-button-default",
    tagsMenu:
      '#tags-dropdown-default-menu[role="menu"][data-hr-dropdown-trigger="tags-dropdown-default-trigger"]',
    tagsSearch:
      '#tags-dropdown-default-menu input[role="searchbox"][aria-controls="tags-dropdown-default-menu"]',
    tagsOptions: '#tags-dropdown-default-menu [role="menuitem"]',
    tagsApply: "button#tags-dropdown-apply",
    tagsCancel: "button#tags-dropdown-cancel",

    tagsModal: '#select-tags-modal[role="dialog"]',
    tagsModalSearch:
      '#select-tags-search input[placeholder="Pesquisar tags ou categorias"], #select-tags-search input',
    tagsModalOptions:
      ".select-tags-item[role=\"button\"][aria-pressed]",
    tagsModalOptionLabel: ".select-tags-chip__label",
    tagsModalLabelText: ".select-tags-chip__label > span",
    tagsModalSelectedChips: ".select-tags__selected .select-tags-chip",
    tagsModalSelectedLabel: ".select-tags-chip__label",
    tagsModalApply: "button#select-tags-apply",
    tagsModalCancel: "button#select-tags-cancel",
    appliedTagChips: '[id^="tag-"], .record-tag-chip',
    appliedTagLabel: ".record-tag-chip__label",

    customControl: "#hg-conversation-control",
    customButton: "#hg-conversation-button",
    customStatus: "#hg-conversation-status",
    customStyle: "#hg-conversation-style",
  });

  const ICONS = Object.freeze({
    open: `
      <svg class="hg-conversation-icon" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
        <circle cx="8.5" cy="7" r="4"></circle>
        <path d="m16 11 2 2 4-4"></path>
      </svg>`,
    close: `
      <svg class="hg-conversation-icon" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <path d="m9 11 3 3L22 4"></path>
      </svg>`,
    closed: `
      <svg class="hg-conversation-icon" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="m8 12 2.5 2.5L16 9"></path>
      </svg>`,
    spinner: `
      <svg class="hg-conversation-icon hg-conversation-spinner" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.22-8.56"></path>
      </svg>`,
  });

  const state = {
    destroyed: false,
    current: null,
    currentUser: null,
    status: "open",
    busy: false,
    busyLabel: "",
    errorMessage: "",
    generation: 0,
    operationController: null,
    observer: null,
    reconcileTimer: null,
    errorTimer: null,
    lastStatusLog: "",
    domReadyHandler: null,
    ownedOwnerMenu: null,
    ownedTagSurface: null,
    confirmedTransition: null,
    currentUserLocationId: "",
  };

  class HGConversationError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "HGConversationError";
      this.code = code;
    }
  }

  const logger = Object.freeze({
    log(message, ...args) {
      console.log(`[HG Conversation] ${message}`, ...args);
    },
    warn(message, ...args) {
      console.warn(`[HG Conversation] ${message}`, ...args);
    },
    error(message, ...args) {
      console.error(`[HG Conversation] ${message}`, ...args);
    },
  });

  function collapseWhitespace(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVisible(element) {
    if (!element?.isConnected || element.getClientRects().length === 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function trackTrustedOwnerInteraction(token) {
    const tracker = {
      detected: false,
      cleanup: () => {},
    };
    const mark = (event) => {
      if (!event.isTrusted) {
        return;
      }

      const target = event.target;
      if (
        (target && token.trigger?.contains(target)) ||
        (target && token.root?.contains(target))
      ) {
        tracker.detected = true;
      }
    };

    ["pointerdown", "keydown", "click"].forEach((eventName) => {
      document.addEventListener(eventName, mark, true);
    });
    tracker.cleanup = () => {
      ["pointerdown", "keydown", "click"].forEach((eventName) => {
        document.removeEventListener(eventName, mark, true);
      });
    };
    return tracker;
  }

  function trackTrustedTagInteraction(token) {
    const tracker = {
      detected: false,
      cleanup: () => {},
    };
    const legacyActionSelector = `${SELECTORS.tagsApply}, ${SELECTORS.tagsCancel}`;
    const mark = (event) => {
      if (!event.isTrusted) {
        return;
      }

      const target = event.target;
      const isInsideRoot = Boolean(target && token.root?.contains(target));
      const isTrigger = Boolean(target && token.trigger?.contains(target));
      const isLegacyAction = Boolean(
        token.variant === "legacy" &&
          target?.closest?.(legacyActionSelector),
      );
      if (isInsideRoot || isTrigger || isLegacyAction) {
        tracker.detected = true;
      }
    };

    ["pointerdown", "keydown", "click"].forEach((eventName) => {
      document.addEventListener(eventName, mark, true);
    });
    tracker.cleanup = () => {
      ["pointerdown", "keydown", "click"].forEach((eventName) => {
        document.removeEventListener(eventName, mark, true);
      });
    };
    return tracker;
  }

  function canonicalizeTrustedInteractionError(error, token, kind) {
    if (
      !token?.interactionTracker?.detected ||
      error?.name === "AbortError" ||
      error?.code === "conversation-changed"
    ) {
      return error;
    }

    const failure = kind === "owner"
      ? new HGConversationError(
          "owner-menu-user-interaction",
          "Owner selection was cancelled because the menu was used manually.",
        )
      : new HGConversationError(
          "tags-surface-user-interaction",
          "Tag update was cancelled because the Tags interface was used manually.",
        );
    try {
      failure.cause = error;
      failure.originalCode = error?.code || "";
    } catch {
      // Keep the canonical safety error even if the browser freezes Errors.
    }
    return failure;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function createAbortError() {
    return new DOMException("Operation aborted", "AbortError");
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) {
      throw createAbortError();
    }
  }

  function awaitWithSignal(
    promise,
    signal,
    { timeout = 0, description = "operation" } = {},
  ) {
    throwIfAborted(signal);

    return new Promise((resolve, reject) => {
      let finished = false;
      let timeoutId = null;
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      };
      const finish = (callback, value) => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        callback(value);
      };
      const onAbort = () => finish(reject, createAbortError());

      signal?.addEventListener("abort", onAbort, { once: true });
      if (timeout > 0) {
        timeoutId = window.setTimeout(() => {
          finish(
            reject,
            new HGConversationError(
              "timeout",
              `Timed out while waiting for ${description}.`,
            ),
          );
        }, timeout);
      }

      Promise.resolve(promise).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    });
  }

  function waitForCondition(
    predicate,
    {
      timeout = CONFIG.timing.elementTimeoutMs,
      signal,
      description = "condition",
    } = {},
  ) {
    return new Promise((resolve, reject) => {
      let observer = null;
      let timeoutId = null;
      let finished = false;

      const cleanup = () => {
        observer?.disconnect();
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
        signal?.removeEventListener("abort", onAbort);
      };

      const finish = (callback, value) => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        callback(value);
      };

      const check = () => {
        if (finished) {
          return;
        }

        if (signal?.aborted) {
          finish(reject, createAbortError());
          return;
        }

        try {
          const result = predicate();
          if (result) {
            finish(resolve, result);
          }
        } catch (error) {
          finish(reject, error);
        }
      };

      const onAbort = () => finish(reject, createAbortError());

      if (signal?.aborted) {
        finish(reject, createAbortError());
        return;
      }

      check();
      if (finished) {
        return;
      }

      observer = new MutationObserver(check);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      timeoutId = window.setTimeout(() => {
        finish(
          reject,
          new HGConversationError(
            "timeout",
            `Timed out while waiting for ${description}.`,
          ),
        );
      }, timeout);

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  function routeFromAppUtils() {
    try {
      const route = window.AppUtils?.RouteHelper?.getCurrentRoute?.();
      const locationId = route?.params?.location_id;
      const conversationId = route?.params?.conversation_id;

      if (locationId && conversationId) {
        return {
          locationId: String(locationId),
          conversationId: String(conversationId),
          routeName: route.name || "",
        };
      }
    } catch (error) {
      logger.warn("AppUtils route lookup failed; using the URL fallback.", error);
    }

    return null;
  }

  function routeFromUrl() {
    const match = window.location.pathname.match(
      /\/v2\/location\/([^/]+)\/conversations\/conversations\/([^/?#]+)/,
    );

    if (!match) {
      return null;
    }

    return {
      locationId: decodeURIComponent(match[1]),
      conversationId: decodeURIComponent(match[2]),
      routeName: "url-fallback",
    };
  }

  function getRouteIdentity() {
    return routeFromAppUtils() || routeFromUrl();
  }

  function getActiveConversationCard() {
    return document.querySelector(SELECTORS.activeConversationCard);
  }

  function getVisibleComposerConversationIds() {
    return [...document.querySelectorAll(SELECTORS.composerInput)]
      .filter(isVisible)
      .map((element) => element.id.slice("composer-input-".length))
      .filter(Boolean);
  }

  function parseTagList(rawValue) {
    return new Set(
      String(rawValue ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    );
  }

  function getConversationSnapshot() {
    const route = getRouteIdentity();
    if (!route) {
      return { valid: false, reason: "not-conversation-route" };
    }

    const card = getActiveConversationCard();
    if (!card?.isConnected) {
      return { valid: false, reason: "active-card-not-ready" };
    }

    const conversationId = card.getAttribute("data-conversation-id") || "";
    const cardLocationId = card.getAttribute("locationid") || route.locationId;

    if (
      conversationId !== route.conversationId ||
      cardLocationId !== route.locationId
    ) {
      return { valid: false, reason: "route-card-mismatch" };
    }

    const composerIds = getVisibleComposerConversationIds();
    if (composerIds.length && !composerIds.includes(conversationId)) {
      return { valid: false, reason: "route-composer-mismatch" };
    }

    const contactId = card.getAttribute("contactid") || "";
    const contactName =
      card.getAttribute("fullname") ||
      card.getAttribute("contactname") ||
      collapseWhitespace(document.querySelector(SELECTORS.contactName)?.textContent);

    return {
      valid: true,
      route,
      card,
      locationId: route.locationId,
      conversationId,
      contactId,
      contactName,
      assignedTo: card.getAttribute("assignedto") || "",
      tags: parseTagList(card.getAttribute("tags")),
      key: `${route.locationId}:${conversationId}:${contactId}`,
    };
  }

  function getDirectChildWithin(element, ancestor) {
    let current = element;
    while (current && current.parentElement !== ancestor) {
      current = current.parentElement;
    }
    return current?.parentElement === ancestor ? current : null;
  }

  function getHeaderMountPoint() {
    const root = document.querySelector(SELECTORS.conversationsRoot);
    const visibleContactNames = root
      ? [...root.querySelectorAll(SELECTORS.contactName)].filter(isVisible)
      : [];

    if (!root || visibleContactNames.length === 0) {
      return null;
    }

    const callButtons = [...root.querySelectorAll(SELECTORS.call)].filter(
      isVisible,
    );
    const nativeActions = [
      ...root.querySelectorAll(SELECTORS.nativeHeaderActions),
    ].filter(isVisible);
    const anchors = [
      ...callButtons.map((element) => ({ element, kind: "stevo" })),
      ...nativeActions.map((element) => ({ element, kind: "native" })),
    ].filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.element === item.element) ===
        index,
    );
    const visibleSlas = [...root.querySelectorAll(SELECTORS.sla)].filter(
      isVisible,
    );
    const candidates = [];

    for (const contactName of visibleContactNames) {
      for (const anchorEntry of anchors) {
        const anchor = anchorEntry.element;
        let header = contactName;
        let headerFound = false;
        while (header && header !== root.parentElement) {
          const rect = header.getBoundingClientRect();
          if (
            header.contains(anchor) &&
            rect.height >= 40 &&
            rect.height <= 80
          ) {
            headerFound = true;
            break;
          }
          header = header.parentElement;
        }

        if (!headerFound || !header || !header.contains(anchor)) {
          continue;
        }

        const nameBranch = getDirectChildWithin(contactName, header);
        const actionsContainer = getDirectChildWithin(anchor, header);
        const anchorBranch = getDirectChildWithin(anchor, actionsContainer);

        if (
          !nameBranch ||
          !actionsContainer ||
          !anchorBranch ||
          nameBranch === actionsContainer ||
          actionsContainer === anchorBranch ||
          !actionsContainer.contains(anchor)
        ) {
          continue;
        }

        const headerSlas = visibleSlas.filter((sla) => header.contains(sla));
        if (headerSlas.some((sla) => !actionsContainer.contains(sla))) {
          continue;
        }

        let candidate = candidates.find(
          (item) =>
            item.header === header &&
            item.actionsContainer === actionsContainer,
        );
        if (!candidate) {
          candidate = {
            header,
            contactName,
            actionsContainer,
            sla: headerSlas.find((sla) => actionsContainer.contains(sla)) || null,
            anchors: [],
          };
          candidates.push(candidate);
        }
        if (!candidate.anchors.some((item) => item.anchor === anchor)) {
          candidate.anchors.push({
            anchor,
            anchorBranch,
            kind: anchorEntry.kind,
          });
        }
      }
    }

    const nativeCandidates = candidates.filter((candidate) =>
      candidate.anchors.some((item) => item.kind === "native"),
    );
    const callCandidates = candidates.filter((candidate) =>
      candidate.anchors.some((item) => item.kind === "stevo"),
    );
    let candidate = null;

    if (nativeCandidates.length === 1) {
      candidate = nativeCandidates[0];
    } else if (nativeCandidates.length > 1 || callCandidates.length !== 1) {
      return null;
    } else {
      candidate = callCandidates[0];
    }

    // Preserve the original visual order when Call exists in the validated
    // action group, but never require it: the native anchor remains sufficient.
    const anchorOption =
      candidate.anchors.find((item) => item.kind === "stevo") ||
      candidate.anchors.find((item) => item.kind === "native");
    const callButton =
      candidate.anchors.find((item) => item.kind === "stevo")?.anchor || null;

    return {
      root,
      header: candidate.header,
      contactName: candidate.contactName,
      sla: candidate.sla,
      callButton,
      anchor: anchorOption.anchor,
      anchorBranch: anchorOption.anchorBranch,
      anchorKind: anchorOption.kind,
      actionsContainer: candidate.actionsContainer,
    };
  }

  function deriveStatus(tags) {
    if (tags.has(CONFIG.tags.closed)) {
      return "closed";
    }
    if (tags.has(CONFIG.tags.open)) {
      return "close";
    }
    return "open";
  }

  function rememberConfirmedTransition(context, tag, status) {
    state.confirmedTransition = {
      key: context.key,
      tag,
      status,
    };
  }

  function deriveEffectiveStatus(snapshot) {
    const appliedTags = getAppliedTags(snapshot);
    const confirmed = state.confirmedTransition;
    if (confirmed?.key === snapshot.key) {
      if (appliedTags.has(confirmed.tag)) {
        state.confirmedTransition = null;
      } else {
        return confirmed.status;
      }
    }

    return deriveStatus(appliedTags);
  }

  function ensureStyles() {
    if (document.querySelector(SELECTORS.customStyle)) {
      return;
    }

    const style = document.createElement("style");
    style.id = "hg-conversation-style";
    style.textContent = `
      .hg-conversation-control {
        display: flex;
        align-items: center;
        flex: 0 0 auto;
        min-width: 0;
      }

      .hg-conversation-button {
        height: 30px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 0 9px;
        border-radius: 7px;
        border: 1px solid transparent;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
        transition: background-color 120ms ease, border-color 120ms ease,
          color 120ms ease, box-shadow 120ms ease;
      }

      .hg-conversation-button:hover:not(:disabled) {
        box-shadow: 0 1px 3px rgba(16, 24, 40, 0.12);
      }

      .hg-conversation-button:focus-visible {
        outline: 2px solid #84adff;
        outline-offset: 2px;
      }

      .hg-conversation-button:disabled {
        cursor: default;
        opacity: 0.78;
      }

      .hg-conversation-button-open {
        color: #067647;
        background: #ecfdf3;
        border-color: #abefc6;
      }

      .hg-conversation-button-open:hover:not(:disabled) {
        background: #dcfae6;
        border-color: #75e0a7;
      }

      .hg-conversation-button-close {
        color: #b42318;
        background: #fef3f2;
        border-color: #fecdca;
      }

      .hg-conversation-button-close:hover:not(:disabled) {
        background: #fee4e2;
        border-color: #fda29b;
      }

      .hg-conversation-button-closed {
        color: #475467;
        background: #f2f4f7;
        border-color: #d0d5dd;
      }

      .hg-conversation-button-error {
        box-shadow: 0 0 0 2px #fedf89;
      }

      .hg-conversation-icon {
        width: 15px;
        height: 15px;
        flex: none;
        stroke: currentColor;
      }

      .hg-conversation-spinner {
        animation: hg-conversation-spin 750ms linear infinite;
      }

      .hg-conversation-status {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      @keyframes hg-conversation-spin {
        to { transform: rotate(360deg); }
      }

      @media (max-width: 1280px) {
        .hg-conversation-button {
          width: 30px;
          padding: 0;
        }

        .hg-conversation-label {
          display: none;
        }
      }
    `;
    document.head.append(style);
  }

  function createControl() {
    const control = document.createElement("div");
    control.id = "hg-conversation-control";
    control.className = "hg-conversation-control";
    control.setAttribute("data-hg-version", VERSION);

    const button = document.createElement("button");
    button.id = "hg-conversation-button";
    button.type = "button";
    button.addEventListener("click", onControlClick);
    control.append(button);

    const status = document.createElement("span");
    status.id = "hg-conversation-status";
    status.className = "hg-conversation-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    control.append(status);

    return control;
  }

  function renderButton() {
    if (state.destroyed) {
      return;
    }

    const button = document.querySelector(SELECTORS.customButton);
    if (!button) {
      return;
    }
    const status = document.querySelector(SELECTORS.customStatus);

    const stableStatus = state.status;
    let label;
    let tooltip;
    let icon;
    let visualStatus = stableStatus;

    if (state.busy) {
      label = state.busyLabel;
      tooltip = state.busyLabel;
      icon = ICONS.spinner;
    } else if (stableStatus === "close") {
      label = CONFIG.labels.close;
      tooltip = CONFIG.tooltips.close;
      icon = ICONS.close;
    } else if (stableStatus === "closed") {
      label = CONFIG.labels.closed;
      tooltip = CONFIG.tooltips.closed;
      icon = ICONS.closed;
      visualStatus = "closed";
    } else {
      label = CONFIG.labels.open;
      tooltip = CONFIG.tooltips.open;
      icon = ICONS.open;
      visualStatus = "open";
    }

    const colorStatus = visualStatus === "close" ? "close" : visualStatus;
    const className = [
      "hg-conversation-button",
      `hg-conversation-button-${colorStatus}`,
      state.errorMessage ? "hg-conversation-button-error" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const disabled = state.busy || stableStatus === "closed";
    const ariaBusy = state.busy ? "true" : "false";
    const renderedState = state.busy ? "busy" : stableStatus;
    const title = state.errorMessage
      ? `${state.errorMessage} — ${tooltip}`
      : tooltip;
    const ariaLabel = state.errorMessage
      ? `${state.errorMessage}. ${tooltip}`
      : tooltip;
    const liveMessage = state.errorMessage || "";

    // The observer also sees this button. Avoid rewriting its children when
    // nothing changed, otherwise our own render would cause a reconcile loop.
    const renderKey = JSON.stringify({
      className,
      disabled,
      ariaBusy,
      renderedState,
      title,
      ariaLabel,
      liveMessage,
      label,
      icon,
    });
    if (button.getAttribute("data-hg-render-key") === renderKey) {
      return;
    }

    button.className = className;
    button.disabled = disabled;
    button.setAttribute("aria-busy", ariaBusy);
    button.setAttribute("data-hg-state", renderedState);
    button.setAttribute("data-hg-render-key", renderKey);
    button.title = title;
    button.setAttribute("aria-label", ariaLabel);
    button.innerHTML = `${icon}<span class="hg-conversation-label">${escapeHtml(
      label,
    )}</span>`;
    if (status) {
      status.textContent = liveMessage;
    }
  }

  function removeDuplicateControls(keep = null) {
    document.querySelectorAll(".hg-conversation-control").forEach((element) => {
      if (element !== keep) {
        element.remove();
      }
    });
  }

  function mountControl(mountPoint) {
    let control = document.querySelector(SELECTORS.customControl);
    const correctlyMounted =
      control?.parentElement === mountPoint.actionsContainer &&
      control.nextElementSibling === mountPoint.anchorBranch;

    if (!correctlyMounted) {
      control?.remove();
      control = createControl();
      mountPoint.actionsContainer.insertBefore(control, mountPoint.anchorBranch);
      logger.log("Mount point detected; control mounted before header action.");
    }

    removeDuplicateControls(control);
    renderButton();
  }

  function extractContactIdFromDetails(detailsRoot) {
    if (!detailsRoot) {
      return "";
    }

    const links = [
      ...detailsRoot.querySelectorAll(SELECTORS.detailsContactLink),
    ];
    const link = links.find(isVisible) || links[0];
    if (!link?.href) {
      return "";
    }

    try {
      const path = new URL(link.href, window.location.href).pathname;
      const match = path.match(/\/contacts\/detail\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : "";
    } catch {
      return "";
    }
  }

  function getDetailsRootForContext(context) {
    if (!context.contactId) {
      return null;
    }

    const matches = [...document.querySelectorAll(SELECTORS.details)].filter(
      (root) =>
        isVisible(root) &&
        extractContactIdFromDetails(root) === context.contactId,
    );
    return matches.length === 1 ? matches[0] : null;
  }

  function detailsBelongToContext(context, expectedRoot = null) {
    const root = getDetailsRootForContext(context);
    return Boolean(root && (!expectedRoot || root === expectedRoot));
  }

  function getVisibleDetailsElement(root, selector) {
    if (!root) {
      return null;
    }

    const matches = [...root.querySelectorAll(selector)].filter(isVisible);
    return matches.length === 1 ? matches[0] : null;
  }

  function getDetailsAction(context, selector) {
    return getVisibleDetailsElement(getDetailsRootForContext(context), selector);
  }

  function detailsRootIsReady(root) {
    return Boolean(
      root &&
        (getVisibleDetailsElement(root, SELECTORS.detailsBody) ||
          getVisibleDetailsElement(root, SELECTORS.ownerTrigger) ||
          getVisibleDetailsElement(root, SELECTORS.tagsTrigger)),
    );
  }

  function detailsPanelIsReady(context) {
    return detailsRootIsReady(getDetailsRootForContext(context));
  }

  function ownerDetailsMatchContext(
    context,
    expectedRoot = null,
    expectedTrigger = null,
  ) {
    const root = getDetailsRootForContext(context);
    const trigger = getVisibleDetailsElement(root, SELECTORS.ownerTrigger);
    return Boolean(
      root &&
        (!expectedRoot || root === expectedRoot) &&
        trigger &&
        (!expectedTrigger || trigger === expectedTrigger),
    );
  }

  function tagDetailsMatchContext(
    context,
    expectedRoot = null,
    expectedTrigger = null,
  ) {
    const root = getDetailsRootForContext(context);
    const trigger = getVisibleDetailsElement(root, SELECTORS.tagsTrigger);
    return Boolean(
      root &&
        (!expectedRoot || root === expectedRoot) &&
        trigger &&
        (!expectedTrigger || trigger === expectedTrigger),
    );
  }

  async function waitForDetailsAction(
    context,
    selector,
    description,
    timeout = CONFIG.timing.elementTimeoutMs,
  ) {
    return waitForCondition(
      () => {
        assertContext(context);
        const detailsRoot = getDetailsRootForContext(context);
        if (!detailsRoot) {
          return null;
        }
        const action = getVisibleDetailsElement(detailsRoot, selector);
        return action ? { detailsRoot, action } : null;
      },
      {
        timeout,
        signal: context.signal,
        description,
      },
    );
  }

  function getContextCard(context) {
    const card = getActiveConversationCard();
    if (
      card?.getAttribute("data-conversation-id") === context.conversationId &&
      (card.getAttribute("contactid") || "") === context.contactId
    ) {
      return card;
    }
    return null;
  }

  function assertContext(context) {
    throwIfAborted(context.signal);
    const snapshot = getConversationSnapshot();

    if (!snapshot.valid || snapshot.key !== context.key) {
      throw new HGConversationError(
        "conversation-changed",
        "The conversation changed during the operation.",
      );
    }

    return snapshot;
  }

  function isCurrentContextKey(key) {
    const snapshot = getConversationSnapshot();
    return snapshot.valid && snapshot.key === key;
  }

  function getAppliedTags(context) {
    const tags = new Set();
    const card = getContextCard(context);

    if (card) {
      parseTagList(card.getAttribute("tags")).forEach((tag) => tags.add(tag));
    }

    const detailsRoot = getDetailsRootForContext(context);
    if (detailsRootIsReady(detailsRoot)) {
      detailsRoot.querySelectorAll(SELECTORS.appliedTagChips).forEach((element) => {
        const label = collapseWhitespace(
          element.querySelector(SELECTORS.appliedTagLabel)?.textContent ||
            element.textContent,
        );
        if (label) {
          tags.add(label);
        }
      });
    }

    return tags;
  }

  function hasAppliedTag(context, tag) {
    return getAppliedTags(context).has(tag);
  }

  function nativeSetInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;

    if (!setter) {
      throw new HGConversationError(
        "input-setter-missing",
        "The native input setter is unavailable.",
      );
    }

    input.focus();
    setter.call(input, value);
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value,
      }),
    );
  }

  async function getCurrentUser(signal, locationId) {
    if (
      state.currentUser &&
      state.currentUserLocationId === collapseWhitespace(locationId)
    ) {
      return state.currentUser;
    }

    const getter = window.AppUtils?.Utilities?.getCurrentUser;
    if (typeof getter !== "function") {
      throw new HGConversationError(
        "current-user-unavailable",
        "Current user could not be identified.",
      );
    }

    const rawUser = await awaitWithSignal(
      getter.call(window.AppUtils.Utilities),
      signal,
      {
        timeout: CONFIG.timing.ownerTimeoutMs,
        description: "the current user",
      },
    );
    const user = {
      id: collapseWhitespace(rawUser?.id),
      name: collapseWhitespace(rawUser?.name),
      firstName: collapseWhitespace(rawUser?.firstName),
      lastName: collapseWhitespace(rawUser?.lastName),
      email: collapseWhitespace(rawUser?.email),
    };

    if (!user.id || !user.name) {
      throw new HGConversationError(
        "current-user-incomplete",
        "Current user data is incomplete.",
      );
    }

    state.currentUser = user;
    state.currentUserLocationId = collapseWhitespace(locationId);
    logger.log("Current user identified.");
    return user;
  }

  function valueContainsExactUserPath(value, userId) {
    if (!value || !userId) {
      return false;
    }

    try {
      const segments = new URL(value, window.location.href).pathname
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);

      return segments.some(
        (segment, index) =>
          segment === "user" && segments[index + 1] === userId,
      );
    } catch {
      return false;
    }
  }

  function elementContainsExactAttributeValue(element, value) {
    if (!element || !value) {
      return false;
    }

    return [element, ...element.querySelectorAll("*")].some((node) =>
      [...node.attributes].some((attribute) => attribute.value.trim() === value),
    );
  }

  function optionContainsUserId(option, userId) {
    return [option, ...option.querySelectorAll("*")].some((node) =>
      [...node.attributes].some((attribute) => {
        if (attribute.value.trim() === userId) {
          return true;
        }

        return (
          ["src", "data-image-src"].includes(attribute.name) &&
          valueContainsExactUserPath(attribute.value, userId)
        );
      }),
    );
  }

  function getOwnerOptionName(option) {
    return collapseWhitespace(
      option.querySelector(".hr-ellipsis")?.textContent ||
        option.querySelector("p.flex-1")?.textContent ||
        option.textContent,
    );
  }

  function findOwnerCandidate(menu, user) {
    const options = [...menu.querySelectorAll('[role="menuitem"]')].filter(
      isVisible,
    );
    const idMatches = options.filter((option) =>
      optionContainsUserId(option, user.id),
    );

    if (idMatches.length === 1) {
      return { option: idMatches[0], method: "id" };
    }
    if (idMatches.length > 1) {
      throw new HGConversationError(
        "owner-id-ambiguous",
        "More than one owner matched the current user ID.",
      );
    }

    if (user.email) {
      const emailMatches = options.filter((option) =>
        elementContainsExactAttributeValue(option, user.email),
      );
      if (emailMatches.length === 1) {
        return { option: emailMatches[0], method: "email" };
      }
      if (emailMatches.length > 1) {
        throw new HGConversationError(
          "owner-email-ambiguous",
          "More than one owner matched the current user email.",
        );
      }
    }

    const nameMatches = options.filter(
      (option) => getOwnerOptionName(option) === user.name,
    );

    if (nameMatches.length === 1) {
      return { option: nameMatches[0], method: "exact-name" };
    }
    if (nameMatches.length > 1) {
      throw new HGConversationError(
        "owner-name-ambiguous",
        "The current user name is ambiguous in the owner list.",
      );
    }

    return null;
  }

  function triggerMatchesUser(context, user) {
    const trigger = getDetailsAction(context, SELECTORS.ownerTrigger);
    if (!trigger) {
      return false;
    }

    if (optionContainsUserId(trigger, user.id)) {
      return true;
    }

    const label = trigger.querySelector(SELECTORS.ownerLabel);
    return (
      collapseWhitespace(
        label?.querySelector(".hr-ellipsis")?.textContent ||
          label?.textContent ||
          trigger.textContent,
      ) === user.name
    );
  }

  function ownerIsApplied(context, user) {
    const card = getContextCard(context);
    const assignedTo = card?.getAttribute("assignedto") || "";

    if (assignedTo) {
      return assignedTo === user.id;
    }

    return ownerDetailsMatchContext(context) && triggerMatchesUser(context, user);
  }

  function listVisibleOwnerMenus() {
    return [...document.querySelectorAll(SELECTORS.ownerMenu)].filter(isVisible);
  }

  function getUniqueVisibleOwnerMenu() {
    const menus = listVisibleOwnerMenus();
    if (menus.length > 1) {
      throw new HGConversationError(
        "owner-menu-ambiguous",
        "More than one owner menu is open; close them before retrying.",
      );
    }
    return menus[0] || null;
  }

  function releaseOwnedOwnerMenu(token) {
    if (state.ownedOwnerMenu === token) {
      state.ownedOwnerMenu = null;
    }
  }

  function assertOwnedOwnerMenu(context, token) {
    assertContext(context);
    const visibleTagSurfaces = listVisibleTagSurfaces();
    if (visibleTagSurfaces.length) {
      throw new HGConversationError(
        visibleTagSurfaces.length > 1
          ? "tags-surface-ambiguous"
          : "tags-surface-in-use",
        "The Tags interface opened during owner selection.",
      );
    }
    const visibleMenus = listVisibleOwnerMenus();

    if (
      !token ||
      state.ownedOwnerMenu !== token ||
      token.key !== context.key ||
      !token.root ||
      visibleMenus.length !== 1 ||
      visibleMenus[0] !== token.root ||
      !isVisible(token.root) ||
      !ownerDetailsMatchContext(context, token.detailsRoot, token.trigger)
    ) {
      throw new HGConversationError(
        "owner-menu-changed",
        "The owner menu or contact changed during the operation.",
      );
    }

    return token.root;
  }

  function throwIfOwnerMenuUsedManually(token) {
    if (!token?.interactionTracker?.detected) {
      return;
    }

    releaseOwnedOwnerMenu(token);
    throw new HGConversationError(
      "owner-menu-user-interaction",
      "Owner selection was cancelled because the menu was used manually.",
    );
  }

  function closeOwnedOwnerMenu(context, token = state.ownedOwnerMenu) {
    if (!token || state.ownedOwnerMenu !== token) {
      return;
    }

    try {
      const visibleMenus = listVisibleOwnerMenus();
      if (
        !token.interactionTracker?.detected &&
        token.key === context.key &&
        isCurrentContextKey(token.key) &&
        token.root &&
        visibleMenus.length === 1 &&
        visibleMenus[0] === token.root &&
        isVisible(token.root) &&
        ownerDetailsMatchContext(context, token.detailsRoot, token.trigger)
      ) {
        token.trigger.click();
      }
    } catch (error) {
      logger.warn("Could not close the owned owner menu safely.", error);
    } finally {
      releaseOwnedOwnerMenu(token);
    }
  }

  async function assignCurrentUser(context, user) {
    assertContext(context);
    if (ownerIsApplied(context, user)) {
      logger.log("Current user is already the owner.");
      return;
    }

    const visibleTagSurfaces = listVisibleTagSurfaces();
    if (visibleTagSurfaces.length) {
      throw new HGConversationError(
        visibleTagSurfaces.length > 1
          ? "tags-surface-ambiguous"
          : "tags-surface-in-use",
        "Close the Tags interface before using Open.",
      );
    }

    if (state.ownedOwnerMenu) {
      throw new HGConversationError(
        "owner-operation-in-progress",
        "Another owner operation is still finishing; retry in a moment.",
      );
    }

    const visibleOwnerMenus = listVisibleOwnerMenus();
    if (visibleOwnerMenus.length) {
      throw new HGConversationError(
        visibleOwnerMenus.length > 1
          ? "owner-menu-ambiguous"
          : "owner-menu-in-use",
        "Close the owner menu before using Open.",
      );
    }

    const { detailsRoot, action: trigger } = await waitForDetailsAction(
      context,
      SELECTORS.ownerTrigger,
      "the Owner control",
      CONFIG.timing.ownerTimeoutMs,
    );

    logger.log("Assigning user...");
    const token = {
      key: context.key,
      contactId: context.contactId,
      detailsRoot,
      trigger,
      root: null,
      interactionTracker: null,
    };
    token.interactionTracker = trackTrustedOwnerInteraction(token);
    state.ownedOwnerMenu = token;

    try {
      assertContext(context);
      const competingTagSurfaces = listVisibleTagSurfaces();
      if (competingTagSurfaces.length) {
        throw new HGConversationError(
          competingTagSurfaces.length > 1
            ? "tags-surface-ambiguous"
            : "tags-surface-in-use",
          "The Tags interface opened before owner selection.",
        );
      }
      if (!detailsBelongToContext(context, detailsRoot)) {
        throw new HGConversationError(
          "owner-contact-mismatch",
          "Contact details changed before opening the owner menu.",
        );
      }
      if (!ownerDetailsMatchContext(context, detailsRoot, trigger)) {
        throw new HGConversationError(
          "owner-trigger-changed",
          "The Owner control changed before selection; the Tags step can still continue.",
        );
      }
      trigger.click();

      const menu = await waitForCondition(
        () => {
          const candidate = getUniqueVisibleOwnerMenu();
          if (!candidate) {
            return null;
          }
          if (token.root && token.root !== candidate) {
            throw new HGConversationError(
              "owner-menu-replaced",
              "The owner menu was replaced while opening.",
            );
          }
          token.root = candidate;
          return candidate;
        },
        {
          timeout: CONFIG.timing.ownerTimeoutMs,
          signal: context.signal,
          description: "the owner dropdown",
        },
      );

      assertOwnedOwnerMenu(context, token);
      throwIfOwnerMenuUsedManually(token);
      const search = menu.querySelector(SELECTORS.ownerSearch);
      if (!isVisible(search)) {
        throw new HGConversationError(
          "owner-search-missing",
          "Owner search field was not found.",
        );
      }

      nativeSetInputValue(search, user.name);

      await waitForCondition(
        () => {
          assertOwnedOwnerMenu(context, token);
          return findOwnerCandidate(menu, user);
        },
        {
          timeout: CONFIG.timing.ownerTimeoutMs,
          signal: context.signal,
          description: "an unambiguous current-user owner option",
        },
      );

      assertOwnedOwnerMenu(context, token);
      throwIfOwnerMenuUsedManually(token);
      const candidate = findOwnerCandidate(menu, user);
      if (!candidate) {
        throw new HGConversationError(
          "owner-option-changed",
          "The current-user owner option changed before selection.",
        );
      }
      logger.log(`Owner matched by ${candidate.method}.`);

      const alreadySelected =
        candidate.option.classList.contains("bg-primary-50") ||
        candidate.option.getAttribute("aria-selected") === "true";

      if (!alreadySelected) {
        assertOwnedOwnerMenu(context, token);
        throwIfOwnerMenuUsedManually(token);
        candidate.option.click();
      } else {
        assertOwnedOwnerMenu(context, token);
        throwIfOwnerMenuUsedManually(token);
        trigger.click();
      }

      await waitForCondition(
        () => !isVisible(menu) && ownerIsApplied(context, user),
        {
          timeout: CONFIG.timing.ownerTimeoutMs,
          signal: context.signal,
          description: "owner assignment confirmation",
        },
      );

      releaseOwnedOwnerMenu(token);
      assertContext(context);
    } catch (error) {
      const failure = canonicalizeTrustedInteractionError(
        error,
        token,
        "owner",
      );
      closeOwnedOwnerMenu(context, token);
      throw failure;
    } finally {
      token.interactionTracker?.cleanup();
    }
  }

  async function ensureDetailsPanel(context) {
    assertContext(context);

    if (detailsPanelIsReady(context)) {
      return {
        openedByScript: false,
        userInteracted: false,
        cleanup() {},
      };
    }

    const panelAlreadyOpen = [...document.querySelectorAll(SELECTORS.details)].some(
      detailsRootIsReady,
    );
    let openedByScript = false;

    if (!panelAlreadyOpen) {
      const icon = document.querySelector(SELECTORS.panelOpenIcon);
      const opener = icon?.closest("button");
      if (!isVisible(opener)) {
        throw new HGConversationError(
          "panel-opener-missing",
          "Contact details panel opener was not found.",
        );
      }

      opener.click();
      openedByScript = true;
    }

    try {
      await waitForCondition(() => detailsPanelIsReady(context), {
        timeout: CONFIG.timing.elementTimeoutMs,
        signal: context.signal,
        description: "contact details for the current conversation",
      });
    } catch (error) {
      if (
        openedByScript &&
        isCurrentContextKey(context.key) &&
        listVisibleOwnerMenus().length === 0 &&
        !hasVisibleTagSurface()
      ) {
        const detailsRoot = getDetailsRootForContext(context);
        const close = getVisibleDetailsElement(detailsRoot, SELECTORS.panelClose);
        if (isVisible(close)) {
          close.click();
        }
      }
      throw error;
    }

    assertContext(context);
    const detailsRoot = getDetailsRootForContext(context);
    if (!detailsRootIsReady(detailsRoot)) {
      throw new HGConversationError(
        "details-root-changed",
        "Contact details changed before the operation started.",
      );
    }
    logger.log("Contact details ready.", { openedByScript });
    const session = {
      openedByScript,
      detailsRoot,
      userInteracted: false,
      cleanup: () => {},
    };
    const markInteraction = (event) => {
      const currentRoot = getDetailsRootForContext(context);
      if (event.isTrusted && currentRoot?.contains(event.target)) {
        session.userInteracted = true;
      }
    };

    document.addEventListener("pointerdown", markInteraction, true);
    document.addEventListener("keydown", markInteraction, true);
    document.addEventListener("click", markInteraction, true);
    session.cleanup = () => {
      document.removeEventListener("pointerdown", markInteraction, true);
      document.removeEventListener("keydown", markInteraction, true);
      document.removeEventListener("click", markInteraction, true);
    };

    return session;
  }

  async function restoreDetailsPanel(session, context) {
    session?.cleanup?.();

    if (
      !session?.openedByScript ||
      session.userInteracted ||
      context.signal.aborted
    ) {
      return;
    }

    try {
      assertContext(context);
    } catch {
      return;
    }

    if (
      listVisibleOwnerMenus().length > 0 ||
      hasVisibleTagSurface()
    ) {
      return;
    }

    const detailsRoot = getDetailsRootForContext(context);
    if (!detailsRootIsReady(detailsRoot)) {
      return;
    }

    const close = getVisibleDetailsElement(detailsRoot, SELECTORS.panelClose);
    if (isVisible(close)) {
      close.click();
    }
  }

  function listVisibleTagSurfaces() {
    const surfaces = [];

    document.querySelectorAll(SELECTORS.tagsModal).forEach((root) => {
      if (isVisible(root)) {
        surfaces.push({ variant: "dialog", root });
      }
    });
    document.querySelectorAll(SELECTORS.tagsMenu).forEach((root) => {
      if (isVisible(root)) {
        surfaces.push({ variant: "legacy", root });
      }
    });

    return surfaces;
  }

  function hasVisibleTagSurface() {
    return listVisibleTagSurfaces().length > 0;
  }

  function getUniqueVisibleTagSurface() {
    const surfaces = listVisibleTagSurfaces();
    if (surfaces.length > 1) {
      throw new HGConversationError(
        "tags-surface-ambiguous",
        "More than one Tags interface is open; close them before retrying.",
      );
    }
    return surfaces[0] || null;
  }

  function getTagSurfaceSearch(surface) {
    const selector =
      surface.variant === "dialog"
        ? SELECTORS.tagsModalSearch
        : 'input[role="searchbox"][aria-controls="tags-dropdown-default-menu"]';
    return surface.root.querySelector(selector);
  }

  function getExactTagOption(surface, tag) {
    const options =
      surface.variant === "dialog"
        ? [...surface.root.querySelectorAll(SELECTORS.tagsModalOptions)]
        : [...surface.root.querySelectorAll('[role="menuitem"]')];
    const exactOptions = options.filter(isVisible).filter((option) => {
      const label =
        surface.variant === "dialog"
          ? option.querySelector(SELECTORS.tagsModalLabelText)?.textContent ||
            option.querySelector(SELECTORS.tagsModalOptionLabel)?.textContent
          : option.textContent;
      return collapseWhitespace(label) === tag;
    });

    if (exactOptions.length > 1) {
      throw new HGConversationError(
        "tag-option-ambiguous",
        `More than one existing tag matched exactly: ${tag}`,
      );
    }
    if (exactOptions.length === 0) {
      return null;
    }

    const option = exactOptions[0];
    if (surface.variant === "dialog") {
      return {
        option,
        selectionNode: option,
        selected: option.getAttribute("aria-pressed") === "true",
      };
    }

    const checkbox = option.querySelector('[role="checkbox"]');
    return {
      option,
      selectionNode: checkbox,
      selected: checkbox?.getAttribute("aria-checked") === "true",
    };
  }

  function getSelectedTagNames(surface) {
    if (surface.variant !== "dialog") {
      return null;
    }

    return new Set(
      [...surface.root.querySelectorAll(SELECTORS.tagsModalSelectedChips)]
        .map((chip) =>
          collapseWhitespace(
            chip.querySelector(SELECTORS.tagsModalLabelText)?.textContent ||
              chip.querySelector(SELECTORS.tagsModalSelectedLabel)?.textContent,
          ),
        )
        .filter(Boolean),
    );
  }

  function setContainsAll(values, required) {
    return [...required].every((value) => values.has(value));
  }

  function setsEqual(left, right) {
    return left.size === right.size && setContainsAll(left, right);
  }

  function getTagSurfaceAction(surface, action) {
    if (surface.variant === "legacy") {
      const visibleSurface = getUniqueVisibleTagSurface();
      if (
        !visibleSurface ||
        visibleSurface.variant !== "legacy" ||
        visibleSurface.root !== surface.root
      ) {
        return null;
      }
    }

    const selector =
      surface.variant === "dialog"
        ? action === "apply"
          ? SELECTORS.tagsModalApply
          : SELECTORS.tagsModalCancel
        : action === "apply"
          ? SELECTORS.tagsApply
          : SELECTORS.tagsCancel;
    const candidates =
      surface.variant === "dialog"
        ? [surface.root.querySelector(selector)].filter(Boolean)
        : [...document.querySelectorAll(selector)].filter(isVisible);

    if (candidates.length > 1) {
      throw new HGConversationError(
        "tags-action-ambiguous",
        `More than one visible Tags ${action} control was found.`,
      );
    }

    const button = candidates[0];

    return isVisible(button) &&
      !button.disabled &&
      button.getAttribute("aria-disabled") !== "true"
      ? button
      : null;
  }

  function releaseOwnedTagSurface(token) {
    if (state.ownedTagSurface === token) {
      state.ownedTagSurface = null;
    }
  }

  function assertOwnedTagSurface(context, token) {
    assertContext(context);

    const visibleOwnerMenus = listVisibleOwnerMenus();
    if (visibleOwnerMenus.length) {
      throw new HGConversationError(
        visibleOwnerMenus.length > 1
          ? "owner-menu-ambiguous"
          : "owner-menu-in-use",
        "The owner menu opened during the Tags operation.",
      );
    }

    if (
      !token ||
      state.ownedTagSurface !== token ||
      token.key !== context.key
    ) {
      throw new HGConversationError(
        "tags-surface-ownership-lost",
        "The Tags interface changed during the operation.",
      );
    }

    const visible = listVisibleTagSurfaces();
    if (
      !token.root ||
      !isVisible(token.root) ||
      visible.length !== 1 ||
      visible[0].root !== token.root ||
      visible[0].variant !== token.variant ||
      !tagDetailsMatchContext(context, token.detailsRoot, token.trigger)
    ) {
      throw new HGConversationError(
        "tags-surface-changed",
        "The Tags interface or contact changed during the operation.",
      );
    }

    return { variant: token.variant, root: token.root };
  }

  function throwIfTagSurfaceUsedManually(token) {
    if (!token?.interactionTracker?.detected) {
      return;
    }

    // From this point the draft belongs to the user. Do not Apply or Cancel it.
    releaseOwnedTagSurface(token);
    throw new HGConversationError(
      "tags-surface-user-interaction",
      "Tag update was cancelled because the Tags interface was used manually.",
    );
  }

  function requestCloseOwnedTagSurface(context, token) {
    if (!token || state.ownedTagSurface !== token) {
      return;
    }

    if (token.interactionTracker?.detected) {
      releaseOwnedTagSurface(token);
      return;
    }

    if (
      token.key === context.key &&
      isCurrentContextKey(token.key) &&
      token.root &&
      isVisible(token.root) &&
      tagDetailsMatchContext(context, token.detailsRoot, token.trigger)
    ) {
      try {
        const surface = { variant: token.variant, root: token.root };
        const cancel = getTagSurfaceAction(surface, "cancel");
        if (cancel) {
          cancel.click();
        } else if (token.variant === "legacy" && isVisible(token.trigger)) {
          token.trigger.click();
        }
      } catch (error) {
        logger.warn("Could not close the owned Tags interface safely.", error);
      }
    }

    releaseOwnedTagSurface(token);
  }

  async function openOwnedTagSurface(context, description) {
    assertContext(context);

    const visibleOwnerMenus = listVisibleOwnerMenus();
    if (visibleOwnerMenus.length) {
      throw new HGConversationError(
        visibleOwnerMenus.length > 1
          ? "owner-menu-ambiguous"
          : "owner-menu-in-use",
        "Close the owner menu before using this control.",
      );
    }

    if (state.ownedTagSurface) {
      throw new HGConversationError(
        "tags-operation-in-progress",
        "Another Tags operation is still finishing; retry in a moment.",
      );
    }

    const alreadyVisible = listVisibleTagSurfaces();
    if (alreadyVisible.length) {
      throw new HGConversationError(
        alreadyVisible.length > 1
          ? "tags-surface-ambiguous"
          : "tags-surface-in-use",
        "Close the Tags interface before using this control.",
      );
    }

    const { detailsRoot, action: trigger } = await waitForDetailsAction(
      context,
      SELECTORS.tagsTrigger,
      "the Tags control",
      CONFIG.timing.tagTimeoutMs,
    );

    const token = {
      key: context.key,
      contactId: context.contactId,
      detailsRoot,
      trigger,
      root: null,
      variant: "",
      interactionTracker: null,
    };
    token.interactionTracker = trackTrustedTagInteraction(token);
    state.ownedTagSurface = token;

    try {
      assertContext(context);
      const competingOwnerMenus = listVisibleOwnerMenus();
      if (competingOwnerMenus.length) {
        throw new HGConversationError(
          competingOwnerMenus.length > 1
            ? "owner-menu-ambiguous"
            : "owner-menu-in-use",
          "The owner menu opened before the Tags operation.",
        );
      }
      if (!detailsBelongToContext(context, detailsRoot)) {
        throw new HGConversationError(
          "tags-contact-mismatch",
          "Contact details changed before opening Tags.",
        );
      }
      if (!tagDetailsMatchContext(context, detailsRoot, trigger)) {
        throw new HGConversationError(
          "tags-trigger-changed",
          "The Tags control changed before opening; no tag was modified.",
        );
      }
      trigger.click();

      await waitForCondition(
        () => {
          assertContext(context);
          const surface = getUniqueVisibleTagSurface();
          if (!surface) {
            return null;
          }

          if (token.root && token.root !== surface.root) {
            throw new HGConversationError(
              "tags-surface-replaced",
              "The Tags interface was replaced while opening.",
            );
          }

          token.root = surface.root;
          token.variant = surface.variant;
          return token;
        },
        {
          timeout: CONFIG.timing.tagTimeoutMs,
          signal: context.signal,
          description,
        },
      );

      assertOwnedTagSurface(context, token);
      logger.log(`Tags interface detected: ${token.variant}.`);
      return token;
    } catch (error) {
      const failure = canonicalizeTrustedInteractionError(
        error,
        token,
        "tags",
      );
      requestCloseOwnedTagSurface(context, token);
      token.interactionTracker?.cleanup();
      throw failure;
    }
  }

  async function dismissOwnedTagSurface(context, token, description) {
    const surface = assertOwnedTagSurface(context, token);
    throwIfTagSurfaceUsedManually(token);

    const cancel = getTagSurfaceAction(surface, "cancel");
    const closeControl = cancel ||
      (token.variant === "legacy" &&
      tagDetailsMatchContext(context, token.detailsRoot, token.trigger)
        ? token.trigger
        : null);

    if (!closeControl) {
      throw new HGConversationError(
        "tags-cancel-missing",
        "The Tags interface could not be closed safely.",
      );
    }

    assertOwnedTagSurface(context, token);
    throwIfTagSurfaceUsedManually(token);
    closeControl.click();

    await waitForCondition(() => !isVisible(token.root), {
      timeout: CONFIG.timing.tagTimeoutMs,
      signal: context.signal,
      description,
    });
    releaseOwnedTagSurface(token);
  }

  async function searchExactTag(context, token, tag) {
    const surface = assertOwnedTagSurface(context, token);
    throwIfTagSurfaceUsedManually(token);
    const search = getTagSurfaceSearch(surface);
    if (!isVisible(search)) {
      throw new HGConversationError(
        "tags-search-missing",
        "Tags search field was not found.",
      );
    }

    nativeSetInputValue(search, tag);
    return waitForCondition(
      () => {
        const currentSurface = assertOwnedTagSurface(context, token);
        const exact = getExactTagOption(currentSurface, tag);
        return exact?.selectionNode ? exact : null;
      },
      {
        timeout: CONFIG.timing.tagTimeoutMs,
        signal: context.signal,
        description: `the existing ${tag} tag option`,
      },
    );
  }

  async function addTag(context, tag) {
    assertContext(context);
    if (hasAppliedTag(context, tag)) {
      logger.log(`Tag already present: ${tag}`);
      return;
    }

    const appliedBefore = getAppliedTags(context);
    logger.log(`Adding tag: ${tag}`);
    let token = null;

    try {
      token = await openOwnedTagSurface(context, "the Tags interface");
      let selectedBefore = null;

      if (token.variant === "dialog") {
        selectedBefore = await waitForCondition(
          () => {
            const surface = assertOwnedTagSurface(context, token);
            const selected = getSelectedTagNames(surface);
            return setContainsAll(selected, appliedBefore) ? selected : null;
          },
          {
            timeout: CONFIG.timing.tagTimeoutMs,
            signal: context.signal,
            description: "the existing selected tags in the Tags dialog",
          },
        );
      }

      await searchExactTag(context, token, tag);
      let surface = assertOwnedTagSurface(context, token);
      throwIfTagSurfaceUsedManually(token);
      let exact = getExactTagOption(surface, tag);

      if (!exact?.selectionNode) {
        throw new HGConversationError(
          "tag-selection-missing",
          `Selection control was not found for tag: ${tag}`,
        );
      }

      if (
        token.variant === "dialog" &&
        selectedBefore.has(tag) !== exact.selected
      ) {
        throw new HGConversationError(
          "tag-selection-inconsistent",
          `The selected state is inconsistent for tag: ${tag}`,
        );
      }

      if (exact.selected) {
        await dismissOwnedTagSurface(
          context,
          token,
          "the already-selected Tags interface to close",
        );
        await waitForCondition(
          () =>
            hasAppliedTag(context, tag) &&
            setContainsAll(getAppliedTags(context), appliedBefore),
          {
            timeout: CONFIG.timing.tagTimeoutMs,
            signal: context.signal,
            description: `the existing applied ${tag} tag`,
          },
        );
        logger.log(`Tag already selected: ${tag}`);
        return;
      }

      assertOwnedTagSurface(context, token);
      throwIfTagSurfaceUsedManually(token);
      exact.option.click();

      const expectedSelected = selectedBefore
        ? new Set([...selectedBefore, tag])
        : null;
      await waitForCondition(
        () => {
          const currentSurface = assertOwnedTagSurface(context, token);
          const currentExact = getExactTagOption(currentSurface, tag);
          if (!currentExact?.selectionNode || !currentExact.selected) {
            return null;
          }

          if (expectedSelected) {
            const selected = getSelectedTagNames(currentSurface);
            if (!setsEqual(selected, expectedSelected)) {
              return null;
            }
          }
          return currentExact;
        },
        {
          timeout: CONFIG.timing.tagTimeoutMs,
          signal: context.signal,
          description: `the staged ${tag} tag`,
        },
      );

      surface = assertOwnedTagSurface(context, token);
      throwIfTagSurfaceUsedManually(token);
      exact = getExactTagOption(surface, tag);
      const selectedNow = getSelectedTagNames(surface);
      if (
        !exact?.selected ||
        (expectedSelected && !setsEqual(selectedNow, expectedSelected))
      ) {
        throw new HGConversationError(
          "tag-staging-changed",
          "The staged tag selection changed before Apply.",
        );
      }

      await waitForCondition(
        () => {
          const currentSurface = assertOwnedTagSurface(context, token);
          const currentExact = getExactTagOption(currentSurface, tag);
          const currentSelected = getSelectedTagNames(currentSurface);
          const draftIsSafe =
            currentExact?.selected &&
            (!expectedSelected || setsEqual(currentSelected, expectedSelected));
          return draftIsSafe
            ? getTagSurfaceAction(currentSurface, "apply")
            : null;
        },
        {
          timeout: CONFIG.timing.tagTimeoutMs,
          signal: context.signal,
          description: `the staged ${tag} tag and Apply button`,
        },
      );

      surface = assertOwnedTagSurface(context, token);
      throwIfTagSurfaceUsedManually(token);
      exact = getExactTagOption(surface, tag);
      const finalSelected = getSelectedTagNames(surface);
      const finalApply = getTagSurfaceAction(surface, "apply");
      if (
        !exact?.selected ||
        (expectedSelected && !setsEqual(finalSelected, expectedSelected)) ||
        !finalApply
      ) {
        throw new HGConversationError(
          "tag-staging-changed",
          "The staged tag selection changed before Apply.",
        );
      }
      finalApply.click();

      await waitForCondition(
        () => {
          assertContext(context);
          const tagsAfter = getAppliedTags(context);
          return (
            !isVisible(token.root) &&
            tagsAfter.has(tag) &&
            setContainsAll(tagsAfter, appliedBefore)
          );
        },
        {
          timeout: CONFIG.timing.tagTimeoutMs,
          signal: context.signal,
          description: `the applied ${tag} tag and preserved prior tags`,
        },
      );

      releaseOwnedTagSurface(token);
      assertContext(context);
    } catch (error) {
      const failure = token
        ? canonicalizeTrustedInteractionError(error, token, "tags")
        : error;
      if (token) {
        requestCloseOwnedTagSurface(context, token);
      }
      if (failure && typeof failure === "object") {
        try {
          failure.hgAppliedTagsBefore ||= new Set(appliedBefore);
        } catch {
          // Some browser-native errors may not accept custom metadata.
        }
      }
      throw failure;
    } finally {
      token?.interactionTracker?.cleanup();
    }
  }

  function captureOwnerState(context) {
    const card = getContextCard(context);
    const assignedTo = card?.getAttribute("assignedto") || "";
    if (assignedTo) {
      return `id:${assignedTo}`;
    }

    const trigger = getDetailsAction(context, SELECTORS.ownerTrigger);
    return `label:${collapseWhitespace(trigger?.textContent)}`;
  }

  function setErrorHint(message, generation) {
    state.errorMessage = message;
    renderButton();

    if (state.errorTimer) {
      window.clearTimeout(state.errorTimer);
    }

    state.errorTimer = window.setTimeout(() => {
      if (state.generation === generation) {
        state.errorMessage = "";
        renderButton();
      }
    }, CONFIG.timing.errorHintMs);
  }

  function captureOperationContext(signal) {
    const snapshot = getConversationSnapshot();
    if (!snapshot.valid || snapshot.key !== state.current?.key) {
      throw new HGConversationError(
        "conversation-not-ready",
        "The current conversation is not ready.",
      );
    }

    return {
      key: snapshot.key,
      locationId: snapshot.locationId,
      conversationId: snapshot.conversationId,
      contactId: snapshot.contactId,
      generation: state.generation,
      signal,
    };
  }

  const OPEN_OPERATION_STOP_CODES = new Set([
    "owner-contact-mismatch",
    "owner-menu-ambiguous",
    "owner-menu-changed",
    "owner-menu-in-use",
    "owner-menu-replaced",
    "owner-menu-user-interaction",
    "owner-operation-in-progress",
    "tags-operation-in-progress",
    "tags-contact-mismatch",
    "tags-surface-ambiguous",
    "tags-surface-changed",
    "tags-surface-in-use",
    "tags-surface-ownership-lost",
    "tags-surface-replaced",
    "tags-surface-user-interaction",
  ]);

  function operationMustStop(error) {
    return (
      error?.name === "AbortError" ||
      error?.code === "conversation-changed" ||
      OPEN_OPERATION_STOP_CODES.has(error?.code)
    );
  }

  function isManualSurfaceInteraction(error) {
    return (
      error?.code === "owner-menu-user-interaction" ||
      error?.code === "tags-surface-user-interaction"
    );
  }

  function errorMessage(error, fallback) {
    return collapseWhitespace(error?.message) || fallback;
  }

  async function waitForIndependentStepCleanup(context, kind) {
    await waitForCondition(
      () => {
        assertContext(context);
        if (kind === "owner") {
          return !state.ownedOwnerMenu && listVisibleOwnerMenus().length === 0;
        }
        return !state.ownedTagSurface && !hasVisibleTagSurface();
      },
      {
        timeout: CONFIG.timing.elementTimeoutMs,
        signal: context.signal,
        description: `${kind} interface cleanup`,
      },
    );
  }

  async function runOpenOperation(context) {
    const panelSession = await ensureDetailsPanel(context);
    let user = null;
    let ownerSucceeded = false;
    let tagSucceeded = false;
    let ownerError = null;
    let tagError = null;

    try {
      try {
        user = await getCurrentUser(context.signal, context.locationId);
        assertContext(context);
        await assignCurrentUser(context, user);
        ownerSucceeded = true;
      } catch (error) {
        if (isManualSurfaceInteraction(error)) {
          panelSession.userInteracted = true;
        }
        if (operationMustStop(error)) {
          throw error;
        }

        await waitForIndependentStepCleanup(context, "owner");
        assertContext(context);
        if (user && ownerIsApplied(context, user)) {
          ownerSucceeded = true;
          logger.warn(
            "Owner assignment was confirmed after the owner step reported an error.",
            error,
          );
        } else {
          ownerError = error;
          logger.warn("Owner step failed; continuing with the open tag.", error);
        }
      }

      assertContext(context);
      const tagAttemptBefore = getAppliedTags(context);
      try {
        await addTag(context, CONFIG.tags.open);
        const tagsAfter = getAppliedTags(context);
        if (
          !tagsAfter.has(CONFIG.tags.open) ||
          !setContainsAll(tagsAfter, tagAttemptBefore)
        ) {
          throw new HGConversationError(
            "open-tag-not-confirmed",
            "The open tag or the prior tags could not be confirmed.",
          );
        }
        tagSucceeded = true;
      } catch (error) {
        if (isManualSurfaceInteraction(error)) {
          panelSession.userInteracted = true;
        }
        if (operationMustStop(error)) {
          if (
            ownerSucceeded &&
            error?.name !== "AbortError" &&
            error?.code !== "conversation-changed"
          ) {
            throw new HGConversationError(
              "open-tag-partial",
              `Owner assigned, but the automatic open-tag step stopped and its result was not confirmed: ${errorMessage(
                error,
                "open tag could not be applied",
              )}`,
            );
          }
          throw error;
        }

        await waitForIndependentStepCleanup(context, "tags");
        assertContext(context);
        const tagsAfter = getAppliedTags(context);
        const requiredTags =
          error?.hgAppliedTagsBefore instanceof Set
            ? error.hgAppliedTagsBefore
            : tagAttemptBefore;
        if (
          tagsAfter.has(CONFIG.tags.open) &&
          setContainsAll(tagsAfter, requiredTags)
        ) {
          tagSucceeded = true;
          logger.warn(
            "The open tag was confirmed after the Tags step reported an error.",
            error,
          );
        } else {
          tagError = error;
          logger.warn(
            "Open tag step failed; preserving any completed owner assignment.",
            error,
          );
        }
      }

      assertContext(context);
      if (tagSucceeded) {
        rememberConfirmedTransition(context, CONFIG.tags.open, "close");
      }

      if (ownerSucceeded && tagSucceeded) {
        logger.log("Conversation opened successfully.");
        return;
      }

      if (tagSucceeded) {
        throw new HGConversationError(
          "open-owner-partial",
          `Open tag applied, but owner assignment failed: ${errorMessage(
            ownerError,
            "current user could not be assigned",
          )}`,
        );
      }

      if (ownerSucceeded) {
        throw new HGConversationError(
          "open-tag-partial",
          `Owner assigned, but the open tag failed: ${errorMessage(
            tagError,
            "open tag could not be applied",
          )}`,
        );
      }

      throw new HGConversationError(
        "open-actions-failed",
        `Owner assignment failed: ${errorMessage(
          ownerError,
          "current user could not be assigned",
        )} Open tag failed: ${errorMessage(
          tagError,
          "open tag could not be applied",
        )}`,
      );
    } finally {
      await restoreDetailsPanel(panelSession, context);
    }
  }

  async function runCloseOperation(context) {
    const panelSession = await ensureDetailsPanel(context);
    const tagsBefore = getAppliedTags(context);
    const ownerBefore = captureOwnerState(context);

    try {
      if (!tagsBefore.has(CONFIG.tags.open)) {
        throw new HGConversationError(
          "open-tag-missing",
          "The open tag is missing; the conversation cannot be closed safely.",
        );
      }

      await addTag(context, CONFIG.tags.closed);

      await waitForCondition(() => {
        const tagsAfter = getAppliedTags(context);
        const priorTagsRemain = [...tagsBefore].every((tag) => tagsAfter.has(tag));
        return (
          tagsAfter.has(CONFIG.tags.open) &&
          tagsAfter.has(CONFIG.tags.closed) &&
          priorTagsRemain &&
          captureOwnerState(context) === ownerBefore
        );
      }, {
        timeout: CONFIG.timing.tagTimeoutMs,
        signal: context.signal,
        description: "closed-tag and preservation confirmation",
      });

      rememberConfirmedTransition(context, CONFIG.tags.closed, "closed");
      logger.log("Conversation closed successfully.");
    } catch (error) {
      if (isManualSurfaceInteraction(error)) {
        panelSession.userInteracted = true;
      }
      throw error;
    } finally {
      await restoreDetailsPanel(panelSession, context);
    }
  }

  async function executeOperation(kind) {
    if (state.busy || state.destroyed) {
      return;
    }

    const controller = new AbortController();
    state.operationController = controller;
    const generation = state.generation;
    let context;

    try {
      context = captureOperationContext(controller.signal);
      state.busy = true;
      state.busyLabel =
        kind === "open" ? CONFIG.labels.opening : CONFIG.labels.closing;
      state.errorMessage = "";
      renderButton();

      if (kind === "open") {
        await runOpenOperation(context);
      } else {
        await runCloseOperation(context);
      }
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "conversation-changed") {
        logger.warn("Operation cancelled because the conversation changed.");
      } else {
        const message = error?.message || "The operation failed.";
        logger.error(message, error);
        if (!state.destroyed && state.generation === generation) {
          setErrorHint(message, generation);
        }
      }
    } finally {
      if (state.operationController === controller) {
        state.operationController = null;
      }

      if (!state.destroyed && state.generation === generation) {
        state.busy = false;
        state.busyLabel = "";
        const snapshot = getConversationSnapshot();
        if (context && snapshot.valid && snapshot.key === state.current?.key) {
          state.current = snapshot;
          state.status = deriveEffectiveStatus(snapshot);
        }
        renderButton();
        scheduleReconcile();
      }
    }
  }

  function onControlClick() {
    if (state.busy || state.status === "closed") {
      return;
    }

    void executeOperation(state.status === "close" ? "close" : "open");
  }

  function resetForConversationChange(nextSnapshot) {
    state.operationController?.abort();
    state.operationController = null;
    state.generation += 1;
    state.busy = false;
    state.busyLabel = "";
    state.errorMessage = "";
    state.lastStatusLog = "";
    state.confirmedTransition = null;
    state.current = nextSnapshot;
    document.querySelector(SELECTORS.customControl)?.remove();

    if (nextSnapshot) {
      logger.log("Conversation detected.");
    }
  }

  function reconcile() {
    if (state.destroyed || !document.body) {
      return;
    }

    const snapshot = getConversationSnapshot();
    if (!snapshot.valid) {
      if (state.current) {
        resetForConversationChange(null);
      }
      removeDuplicateControls();
      return;
    }

    if (snapshot.key !== state.current?.key) {
      resetForConversationChange(snapshot);
    } else {
      state.current = snapshot;
    }

    if (!state.busy) {
      state.status = deriveEffectiveStatus(snapshot);
    }

    const mountPoint = getHeaderMountPoint();
    if (!mountPoint) {
      document.querySelector(SELECTORS.customControl)?.remove();
      return;
    }

    mountControl(mountPoint);

    const statusLog = `${snapshot.key}:${state.status}`;
    if (statusLog !== state.lastStatusLog) {
      state.lastStatusLog = statusLog;
      logger.log("Header detected; state:", state.status);
    }
  }

  function scheduleReconcile() {
    if (state.destroyed || state.reconcileTimer) {
      return;
    }

    state.reconcileTimer = window.setTimeout(() => {
      state.reconcileTimer = null;
      reconcile();
    }, CONFIG.timing.reconcileDebounceMs);
  }

  function start() {
    if (state.destroyed || state.observer || !document.body) {
      return;
    }

    ensureStyles();
    state.observer = new MutationObserver(scheduleReconcile);
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-is-active",
        "data-conversation-id",
        "contactid",
        "locationid",
        "tags",
        "assignedto",
        "id",
      ],
    });

    window.addEventListener("popstate", scheduleReconcile);
    window.addEventListener("hashchange", scheduleReconcile);
    logger.log(`Initialized v${VERSION}.`);
    reconcile();
  }

  function destroy() {
    if (state.destroyed) {
      return;
    }

    if (state.ownedTagSurface) {
      const token = state.ownedTagSurface;
      requestCloseOwnedTagSurface(
        { key: token.key, contactId: token.contactId },
        token,
      );
    }
    if (state.ownedOwnerMenu) {
      const token = state.ownedOwnerMenu;
      closeOwnedOwnerMenu(
        { key: token.key, contactId: token.contactId },
        token,
      );
    }

    state.destroyed = true;
    state.operationController?.abort();
    state.observer?.disconnect();
    state.observer = null;

    if (state.reconcileTimer) {
      window.clearTimeout(state.reconcileTimer);
    }
    if (state.errorTimer) {
      window.clearTimeout(state.errorTimer);
    }

    window.removeEventListener("popstate", scheduleReconcile);
    window.removeEventListener("hashchange", scheduleReconcile);
    if (state.domReadyHandler) {
      document.removeEventListener("DOMContentLoaded", state.domReadyHandler);
    }

    document
      .querySelectorAll(".hg-conversation-control")
      .forEach((element) => element.remove());
    document.querySelector(SELECTORS.customStyle)?.remove();

    if (window[INSTANCE_KEY]?.destroy === destroy) {
      delete window[INSTANCE_KEY];
    }
  }

  window[INSTANCE_KEY] = Object.freeze({ VERSION, destroy });

  if (document.body) {
    start();
  } else {
    state.domReadyHandler = start;
    document.addEventListener("DOMContentLoaded", start, { once: true });
  }
})();
