var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.Logger = (function () {
  function safeJson_(value) {
    try {
      return JSON.stringify(value === undefined ? null : value);
    } catch (error) {
      return JSON.stringify({ serializationError: String(error) });
    }
  }

  function create(context) {
    var executionId = Utilities.getUuid();
    var entries = [];

    function add_(level, message, details) {
      var entry = {
        timestamp: new Date().toISOString(),
        level: level,
        executionId: executionId,
        context: context || '',
        message: String(message || ''),
        details: details === undefined ? null : details
      };
      entries.push(entry);
      var line = '[' + level + '] [' + executionId + '] ' + entry.message;
      if (level === 'ERROR') console.error(line, entry.details);
      else if (level === 'WARN') console.warn(line, entry.details);
      else console.log(line, entry.details);
      return entry;
    }

    function rows() {
      return entries.map(function (entry) {
        return [
          entry.timestamp, entry.level, entry.executionId, entry.context,
          entry.message, safeJson_(entry.details)
        ];
      });
    }

    return {
      executionId: executionId,
      info: function (message, details) { return add_('INFO', message, details); },
      warn: function (message, details) { return add_('WARN', message, details); },
      error: function (message, details) { return add_('ERROR', message, details); },
      entries: function () { return entries.slice(); },
      rows: rows
    };
  }

  return { create: create };
})();
