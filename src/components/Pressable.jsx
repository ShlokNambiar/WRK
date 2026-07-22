import { forwardRef } from 'react'
import { motion } from 'framer-motion'

// Accessible pressable: a real <button> with a spring press-state and a
// visible focus ring (keyboard only). Use for anything tappable.
// forwardRef so dialogs can move focus onto a button programmatically.
const Pressable = forwardRef(function Pressable({
  children,
  onPress,
  style,
  ariaLabel,
  ariaPressed,
  as = 'button',
  scale = 0.95,
  stop = false,
  ...rest
}, ref) {
  const Comp = motion[as] || motion.button
  const base = {
    appearance: 'none',
    border: 'none',
    background: 'none',
    padding: 0,
    margin: 0,
    font: 'inherit',
    color: 'inherit',
    textAlign: 'inherit',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    outline: 'none',
    ...style,
  }
  return (
    <Comp
      ref={ref}
      type={as === 'button' ? 'button' : undefined}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={(e) => {
        if (stop) e.stopPropagation()
        onPress?.(e)
      }}
      whileTap={{ scale }}
      transition={{ type: 'spring', stiffness: 600, damping: 24 }}
      className="hq-focus"
      style={base}
      {...rest}
    >
      {children}
    </Comp>
  )
})

export default Pressable
