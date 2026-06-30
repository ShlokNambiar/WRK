// Blue radial-gradient avatar, ringed white. (Ported from the WRK design.)
export default function Avatar({ size = 36 }) {
  const px = (Number(size) || 36) + 'px'
  return (
    <div
      style={{
        width: px,
        height: px,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 34% 30%,#bcd4ff,#5b8cff 60%,#1a18f0)',
        boxShadow: '0 0 0 3px #fff,0 5px 14px rgba(26,24,240,.35)',
      }}
    />
  )
}
