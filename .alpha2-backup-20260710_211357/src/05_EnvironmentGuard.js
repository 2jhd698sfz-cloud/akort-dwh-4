var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.EnvironmentGuard = (function () {
  function check_(name, fn) {
    try {
      var value = fn();
      return { check: name, status: 'PASS', actual: value, message: '' };
    } catch (error) {
      return { check: name, status: 'FAIL', actual: '', message: String(error.message || error) };
    }
  }

  function verify() {
    var config = AKORT.Config.load();
    var r = config.resources;
    var checks = [];

    checks.push(check_('environment_is_dev', function () {
      if (config.environment !== 'DEV') throw new Error('Expected DEV, got ' + config.environment);
      return config.environment;
    }));

    checks.push(check_('script_id_matches', function () {
      var actual = ScriptApp.getScriptId();
      if (actual !== config.expectedScriptId) throw new Error('Unexpected Script ID');
      return actual;
    }));

    checks.push(check_('resources_not_blocked', function () {
      var blocked = config.blockedResourceIds || [];
      var activeIds = Object.keys(r).map(function (key) { return r[key]; });
      var conflict = activeIds.filter(function (id) { return blocked.indexOf(id) >= 0; });
      if (conflict.length) throw new Error('DEV configuration points to blocked production resources');
      return 'no conflicts';
    }));

    checks.push(check_('dwh_name_matches', function () {
      var name = SpreadsheetApp.openById(r.dwhSpreadsheetId).getName();
      if (name !== config.expectedNames.dwh) throw new Error('Unexpected DWH name: ' + name);
      return name;
    }));

    checks.push(check_('publish_name_matches', function () {
      var name = SpreadsheetApp.openById(r.publishSpreadsheetId).getName();
      if (name !== config.expectedNames.publish) throw new Error('Unexpected Publish name: ' + name);
      return name;
    }));

    checks.push(check_('dev_root_name_matches', function () {
      var name = DriveApp.getFolderById(r.devRootFolderId).getName();
      if (name !== config.expectedNames.devRoot) throw new Error('Unexpected DEV root name: ' + name);
      return name;
    }));

    ['devTablesFolderId', 'testFilesFolderId', 'testResultsFolderId', 'releasesFolderId', 'docsFolderId']
      .forEach(function (key) {
        checks.push(check_('folder_access_' + key, function () {
          return DriveApp.getFolderById(r[key]).getName();
        }));
      });

    return {
      ok: checks.every(function (item) { return item.status === 'PASS'; }),
      checks: checks,
      checkedAt: new Date().toISOString()
    };
  }

  function assertDev() {
    var result = verify();
    if (!result.ok) {
      var failures = result.checks
        .filter(function (item) { return item.status === 'FAIL'; })
        .map(function (item) { return item.check + ': ' + item.message; });
      throw new Error('DEV environment guard failed. ' + failures.join(' | '));
    }
    return result;
  }

  return {
    verify: verify,
    assertDev: assertDev
  };
})();
