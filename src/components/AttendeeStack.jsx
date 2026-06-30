// Overlapping attendee avatars with a "+N" overflow chip.
export default function AttendeeStack({ avatars = [], overflow = 0 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {avatars.map((a, i) => (
        <span key={i} style={{
          width: 24, height: 24, borderRadius: '50%', background: a.grad,
          border: '2px solid #fff', marginLeft: i === 0 ? 0 : -8,
        }} />
      ))}
      {overflow > 0 && (
        <span style={{
          width: 24, height: 24, borderRadius: '50%', background: '#eceaf9', border: '2px solid #fff',
          marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700, color: '#1a18f0',
        }}>+{overflow}</span>
      )}
    </div>
  )
}
