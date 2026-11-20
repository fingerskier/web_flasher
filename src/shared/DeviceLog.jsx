export default function DeviceLog({ logs, partial, clearLogs }) {
  const text = [...logs.slice(-20), ...(partial ? [partial] : [])].join('\n')
  return (
    <section className="panel device-log" aria-labelledby="device-log-heading">
      <div className="section-heading">
        <h2 id="device-log-heading">Device log</h2>
        <button type="button" onClick={clearLogs}>Clear logs</button>
      </div>
      <pre role="log" aria-labelledby="device-log-heading" aria-live="polite" aria-relevant="additions text" tabIndex={0}>{text || 'No device output yet.'}</pre>
    </section>
  )
}
