interface LogoProps {
  width?: number
  height?: number
  className?: string
}

export default function Logo({ width = 301, height = 343, className }: LogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 301 343"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Logo"
    >
      {/* Main body — rounded speech-bubble shape */}
      <path
        d="M0 50C0 22.3858 22.3858 0 50 0H217.113C244.727 0 267.113 22.3858 267.113 50V98.6307C267.113 126.119 244.801 148.297 217.899 153.938C201.98 157.276 179.974 160.644 111.34 159.463C98.8698 159.249 87.3741 166.636 82.649 178.179L55.5 244.5L48.3527 257.185C35.3044 280.343 0 271.081 0 244.5V88.7455V50Z"
        fill="var(--logo-brand, #00A86B)"
      />
      {/* Arrow tail — pointing right */}
      <path
        d="M121.5 168.494L202.002 168.932C207.976 168.965 213.759 171.379 217.873 175.558L301 260L211.014 259.51C207.921 259.493 204.935 258.199 202.872 255.981L121.5 168.494Z"
        fill="var(--logo-brand, #00A86B)"
      />
      {/* Inner pill — white rounded rectangle */}
      <path
        d="M25 74.1048C25 45.8804 47.8804 23 76.1048 23H170.798C199.023 23 221.903 45.8804 221.903 74.1048V74.1048C221.903 102.329 199.023 125.21 170.798 125.21H76.1048C47.8804 125.21 25 102.329 25 74.1048V74.1048Z"
        fill="white"
      />
      {/* Inner leaf — white teardrop */}
      <path
        d="M45.2828 162.438L46.9369 108.884C46.9369 108.884 118.5 59.5 95.045 108.729C71.5897 157.958 45.2828 162.438 45.2828 162.438Z"
        fill="white"
        stroke="white"
        strokeWidth="10"
      />
    </svg>
  )
}
