# Beta.1.6 operator facade

The facade closes one operator usability gap after a Full Audit is submitted
from the Apps Script editor.

`AKORT_beta16FullAuditContinueLatest` resolves the single active
`FULL_AUDIT_V4` operation through the accepted Beta.1.4 operational status
and resumes it through the existing Beta.1.6 module and Operation Engine.

`AKORT_beta16FullAuditStatusLatest` returns the active operation status or,
after completion, the latest durable Full Audit evidence.

The facade accepts no arguments and prints the complete JSON result through
the established `AKORT_printResult_` entrypoint helper.

It creates no operation, table, trigger, dispatcher, executor, or Drive file.
It does not enumerate Drive, read physical RAW or Publish targets, perform
physical deletion, touch production, or enable the general user pipeline.
