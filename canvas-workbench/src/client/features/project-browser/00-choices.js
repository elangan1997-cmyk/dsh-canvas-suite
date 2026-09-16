    // 项目选择必须跨聊天切换、页面刷新和 DSH 重启保留。
    // v2 使用 { exact, lastByCwd }，同时读取旧版 sessionStorage 平面对象，
    // 因此升级不会让现有项目绑定丢失。
    let projectChoices = {};
    let projectChoicesByCwd = {};
    const loadProjectChoices = () => {
      const exact = {};
      const byCwd = {};
      const merge = (value) => {
        if (!value || typeof value !== 'object') return;
        if (value.exact && typeof value.exact === 'object') {
          Object.assign(exact, value.exact);
        } else {
          // 旧版本直接把 sessionId::cwd 映射放在根对象。
          for (const [key, project] of Object.entries(value)) {
            if (typeof project !== 'string') continue;
            if (key.indexOf('cwd::') === 0) byCwd[key] = project;
            else exact[key] = project;
          }
        }
        if (value.lastByCwd && typeof value.lastByCwd === 'object') {
          Object.assign(byCwd, value.lastByCwd);
        }
      };
      const parse = (raw, asCwdOnly) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (asCwdOnly && parsed && typeof parsed === 'object') {
            for (const [key, project] of Object.entries(parsed)) {
              if (typeof project === 'string') byCwd[key] = project;
            }
          } else merge(parsed);
        } catch (e) {}
      };
      // localStorage 优先；旧 sessionStorage 仅用于迁移/兼容。
      parse(readStorageValue(window.localStorage, PROJECT_CHOICES_KEY));
      parse(readStorageValue(window.localStorage, LEGACY_PROJECT_CHOICES_KEY));
      parse(readStorageValue(window.sessionStorage, PROJECT_CHOICES_KEY));
      parse(readStorageValue(window.sessionStorage, LEGACY_PROJECT_CHOICES_KEY));
      parse(readStorageValue(window.localStorage, PROJECT_CHOICES_BY_CWD_KEY), true);
      parse(readStorageValue(window.sessionStorage, PROJECT_CHOICES_BY_CWD_KEY), true);
      return { exact, byCwd };
    };
    const loadedProjectChoices = loadProjectChoices();
    ({ exact: projectChoices, byCwd: projectChoicesByCwd } = loadedProjectChoices);
    // 首次升级时立即把旧 sessionStorage 绑定迁移到持久存储，
    // 不要求用户再手动打开/切换一次项目才完成迁移。
    if (Object.keys(projectChoices).length || Object.keys(projectChoicesByCwd).length) {
      writeStorageValue(window.localStorage, PROJECT_CHOICES_KEY, JSON.stringify({ exact: projectChoices, lastByCwd: projectChoicesByCwd }));
      writeStorageValue(window.localStorage, PROJECT_CHOICES_BY_CWD_KEY, JSON.stringify(projectChoicesByCwd));
    }
    function projectCwdKey(cwd) {
      return 'cwd::' + String(cwd || '');
    }
    function projectChoiceKey(cwd, sessionId) {
      return String(sessionId || '') + '::' + String(cwd || '');
    }
    function chosenProject(cwd, sessionId, allowCwdFallback = true) {
      const exactKey = projectChoiceKey(cwd, sessionId);
      if (Object.prototype.hasOwnProperty.call(projectChoices, exactKey)) {
        return projectChoices[exactKey] || '';
      }
      // 工作目录兜底只用于首次启动或旧版 DSH 没有会话 ID 的场景；
      // 已在运行中的聊天切换不得把另一个聊天的项目串过来。
      return allowCwdFallback ? (projectChoicesByCwd[projectCwdKey(cwd)] || '') : '';
    }
    function rememberProject(cwd, project, sessionId) {
      if (!cwd) return;
      const value = project || '';
      if (sessionId) projectChoices[projectChoiceKey(cwd, sessionId)] = value;
      projectChoicesByCwd[projectCwdKey(cwd)] = value;
      const serialized = JSON.stringify({ exact: projectChoices, lastByCwd: projectChoicesByCwd });
      const flatLegacy = JSON.stringify(projectChoices);
      writeStorageValue(window.localStorage, PROJECT_CHOICES_KEY, serialized);
      writeStorageValue(window.localStorage, PROJECT_CHOICES_BY_CWD_KEY, JSON.stringify(projectChoicesByCwd));
      // 保留旧键，便于尚未热更新的同页副本读取到最新绑定。
      writeStorageValue(window.sessionStorage, LEGACY_PROJECT_CHOICES_KEY, flatLegacy);
      writeStorageValue(window.sessionStorage, PROJECT_CHOICES_KEY, serialized);
    }

