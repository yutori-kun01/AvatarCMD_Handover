"use client"

import React from "react"

import { useEffect, useRef, useState } from "react"

interface Node {
  id: string
  name: string
  role: string
  x: number
  y: number
  radius: number
  color: string
  status: "active" | "paused" | "learning"
}

interface Link {
  source: string
  target: string
  strength: number
}

const nodes: Node[] = [
  { id: "1", name: "Haru", role: "ADHD/内向型", x: 0.3, y: 0.35, radius: 28, color: "#a78bfa", status: "active" },
  { id: "2", name: "Kai", role: "バイブコーダー", x: 0.55, y: 0.25, radius: 26, color: "#22d3ee", status: "active" },
  { id: "3", name: "Mio", role: "ウェルネス", x: 0.75, y: 0.55, radius: 30, color: "#34d399", status: "learning" },
  { id: "4", name: "Ren", role: "トレンド", x: 0.45, y: 0.65, radius: 32, color: "#fbbf24", status: "active" },
  { id: "5", name: "Sora", role: "キュレーター", x: 0.2, y: 0.65, radius: 22, color: "#f472b6", status: "paused" },
]

const links: Link[] = [
  { source: "1", target: "2", strength: 0.8 },
  { source: "1", target: "3", strength: 0.5 },
  { source: "2", target: "4", strength: 0.7 },
  { source: "4", target: "5", strength: 0.4 },
  { source: "1", target: "4", strength: 0.3 },
  { source: "3", target: "4", strength: 0.6 },
]

export function CollabNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const animationRef = useRef<number>(0)
  const timeRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const container = canvas.parentElement
    if (!container) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setDimensions({ width, height })
        canvas.width = width * window.devicePixelRatio
        canvas.height = height * window.devicePixelRatio
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
      }
    })

    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || dimensions.width === 0) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio
    ctx.scale(dpr, dpr)

    const draw = () => {
      timeRef.current += 0.01
      const t = timeRef.current

      ctx.clearRect(0, 0, dimensions.width, dimensions.height)

      // Draw links
      for (const link of links) {
        const source = nodes.find((n) => n.id === link.source)
        const target = nodes.find((n) => n.id === link.target)
        if (!source || !target) continue

        const sx = source.x * dimensions.width + Math.sin(t + Number(source.id)) * 3
        const sy = source.y * dimensions.height + Math.cos(t + Number(source.id)) * 3
        const tx = target.x * dimensions.width + Math.sin(t + Number(target.id)) * 3
        const ty = target.y * dimensions.height + Math.cos(t + Number(target.id)) * 3

        const isHighlighted = hovered === link.source || hovered === link.target
        ctx.strokeStyle = isHighlighted
          ? `rgba(34, 211, 238, ${0.5 * link.strength})`
          : `rgba(34, 211, 238, ${0.15 * link.strength})`
        ctx.lineWidth = isHighlighted ? 2 : 1
        ctx.setLineDash([4, 4])
        ctx.lineDashOffset = -t * 20

        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(tx, ty)
        ctx.stroke()
        ctx.setLineDash([])

        // Animated particle on link
        if (source.status === "active" && target.status === "active") {
          const progress = (Math.sin(t * 2 + Number(link.source)) + 1) / 2
          const px = sx + (tx - sx) * progress
          const py = sy + (ty - sy) * progress
          ctx.fillStyle = "rgba(34, 211, 238, 0.8)"
          ctx.beginPath()
          ctx.arc(px, py, 2, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Draw nodes
      for (const node of nodes) {
        const nx = node.x * dimensions.width + Math.sin(t + Number(node.id)) * 3
        const ny = node.y * dimensions.height + Math.cos(t + Number(node.id)) * 3
        const isHovered = hovered === node.id

        // Glow
        if (node.status === "active") {
          const pulseSize = node.radius + 8 + Math.sin(t * 3 + Number(node.id)) * 4
          const gradient = ctx.createRadialGradient(nx, ny, node.radius, nx, ny, pulseSize)
          gradient.addColorStop(0, `${node.color}33`)
          gradient.addColorStop(1, `${node.color}00`)
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.arc(nx, ny, pulseSize, 0, Math.PI * 2)
          ctx.fill()
        }

        // Node circle
        ctx.fillStyle = isHovered ? node.color : `${node.color}cc`
        ctx.beginPath()
        ctx.arc(nx, ny, isHovered ? node.radius + 2 : node.radius, 0, Math.PI * 2)
        ctx.fill()

        // Border
        ctx.strokeStyle = isHovered ? node.color : `${node.color}66`
        ctx.lineWidth = isHovered ? 2 : 1
        ctx.beginPath()
        ctx.arc(nx, ny, isHovered ? node.radius + 2 : node.radius, 0, Math.PI * 2)
        ctx.stroke()

        // Name
        ctx.fillStyle = "#0d1117"
        ctx.font = "bold 11px Inter, sans-serif"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(node.name, nx, ny - 2)

        // Role below
        ctx.fillStyle = isHovered ? "#e2e8f0" : "#64748b"
        ctx.font = "9px Inter, sans-serif"
        ctx.fillText(node.role, nx, ny + node.radius + 14)

        // Status indicator
        if (node.status === "active") {
          ctx.fillStyle = "#34d399"
        } else if (node.status === "learning") {
          ctx.fillStyle = "#fbbf24"
        } else {
          ctx.fillStyle = "#64748b"
        }
        ctx.beginPath()
        ctx.arc(nx + node.radius - 4, ny - node.radius + 4, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = "#0d1117"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(nx + node.radius - 4, ny - node.radius + 4, 4, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Reset scale for next frame
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)

      animationRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [dimensions, hovered])

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const t = timeRef.current

    let found: string | null = null
    for (const node of nodes) {
      const nx = node.x * dimensions.width + Math.sin(t + Number(node.id)) * 3
      const ny = node.y * dimensions.height + Math.cos(t + Number(node.id)) * 3
      const dist = Math.sqrt((mx - nx) ** 2 + (my - ny) ** 2)
      if (dist < node.radius + 5) {
        found = node.id
        break
      }
    }
    setHovered(found)
    canvas.style.cursor = found ? "pointer" : "default"
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">
          コラボレーションネットワーク
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-accent" />
            稼働中
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-chart-3" />
            学習中
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
            停止中
          </span>
        </div>
      </div>
      <div className="relative h-[280px] p-2">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
          className="h-full w-full"
        />
      </div>
    </div>
  )
}
