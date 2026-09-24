"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Minus, Square, Copy, X } from "lucide-react";

interface ResizableComposerModalProps {
  isOpen: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null;

export function ResizableComposerModal({
  isOpen,
  title = "Compose Message",
  onClose,
  children,
}: ResizableComposerModalProps) {
  // Dimensions state - defaults to ~80% of window width and height
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 860,
    height: 640,
  });
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isDraggingHandle, setIsDraggingHandle] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    direction: ResizeDirection;
  } | null>(null);

  // Initialize dimensions to ~80% on client load
  useEffect(() => {
    if (typeof window !== "undefined") {
      const w = Math.min(Math.round(window.innerWidth * 0.8), 1050);
      const h = Math.min(Math.round(window.innerHeight * 0.82), 820);
      setDimensions({
        width: Math.max(w, 480),
        height: Math.max(h, 400),
      });
    }
  }, []);

  // Handle Mouse Drag for Resizing
  const handleMouseDown = (direction: ResizeDirection) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMaximized || isMinimized) return;

    setIsDraggingHandle(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: dimensions.width,
      startHeight: dimensions.height,
      direction,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const { startX, startY, startWidth, startHeight, direction } = dragStartRef.current;
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;

      // Adjust width
      if (direction === "w" || direction === "nw" || direction === "sw") {
        newWidth = startWidth - deltaX;
      } else if (direction === "e" || direction === "ne" || direction === "se") {
        newWidth = startWidth + deltaX;
      }

      // Adjust height
      if (direction === "n" || direction === "nw" || direction === "ne") {
        newHeight = startHeight - deltaY;
      } else if (direction === "s" || direction === "sw" || direction === "se") {
        newHeight = startHeight + deltaY;
      }

      // Clamp dimensions
      const maxWidth = window.innerWidth - 32;
      const maxHeight = window.innerHeight - 40;
      const clampedWidth = Math.min(Math.max(newWidth, 420), maxWidth);
      const clampedHeight = Math.min(Math.max(newHeight, 350), maxHeight);

      setDimensions({
        width: clampedWidth,
        height: clampedHeight,
      });
    };

    const handleMouseUp = () => {
      setIsDraggingHandle(false);
      dragStartRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  if (!isOpen) return null;

  // Minimized floating dock tab
  if (isMinimized) {
    return (
      <div className="fixed bottom-0 right-8 z-50 bg-slate-900 text-white rounded-t-xl shadow-2xl border border-slate-700 w-72 flex items-center justify-between px-3.5 py-2.5 transition-all animate-in slide-in-from-bottom-3">
        <span className="text-xs font-semibold truncate select-none">{title}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(false)}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
            title="Expand"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-red-400 rounded hover:bg-slate-800 transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/25 backdrop-blur-[1px] transition-opacity ${
        isDraggingHandle ? "select-none cursor-grabbing" : ""
      }`}
    >
      <div
        ref={containerRef}
        style={
          isMaximized
            ? { width: "calc(100vw - 24px)", height: "calc(100vh - 24px)" }
            : { width: `${dimensions.width}px`, height: `${dimensions.height}px` }
        }
        className="relative bg-white rounded-2xl shadow-2xl border border-slate-200/90 flex flex-col overflow-hidden animate-in fade-in-50 zoom-in-95 transition-[width,height] duration-75"
      >
        {/* Resize Handles (only active when not maximized) */}
        {!isMaximized && (
          <>
            {/* Top border handle */}
            <div
              onMouseDown={handleMouseDown("n")}
              className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize z-30 hover:bg-blue-400/30 transition-colors"
              title="Drag to resize height"
            />
            {/* Bottom border handle */}
            <div
              onMouseDown={handleMouseDown("s")}
              className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize z-30 hover:bg-blue-400/30 transition-colors"
              title="Drag to resize height"
            />
            {/* Left border handle */}
            <div
              onMouseDown={handleMouseDown("w")}
              className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize z-30 hover:bg-blue-400/30 transition-colors"
              title="Drag to resize width"
            />
            {/* Right border handle */}
            <div
              onMouseDown={handleMouseDown("e")}
              className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize z-30 hover:bg-blue-400/30 transition-colors"
              title="Drag to resize width"
            />
            {/* Top-Left corner handle */}
            <div
              onMouseDown={handleMouseDown("nw")}
              className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-40 hover:bg-blue-500/40 rounded-tl-2xl transition-colors"
              title="Drag to resize"
            />
            {/* Top-Right corner handle */}
            <div
              onMouseDown={handleMouseDown("ne")}
              className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize z-40 hover:bg-blue-500/40 rounded-tr-2xl transition-colors"
              title="Drag to resize"
            />
            {/* Bottom-Left corner handle */}
            <div
              onMouseDown={handleMouseDown("sw")}
              className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize z-40 hover:bg-blue-500/40 rounded-bl-2xl transition-colors"
              title="Drag to resize"
            />
            {/* Bottom-Right corner handle */}
            <div
              onMouseDown={handleMouseDown("se")}
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-40 hover:bg-blue-500/40 rounded-br-2xl transition-colors"
              title="Drag to resize"
            />
          </>
        )}

        {/* Modal Top Control Bar */}
        <div
          onDoubleClick={() => setIsMaximized(!isMaximized)}
          className="h-10 px-4 bg-slate-100/90 border-b border-slate-200 flex items-center justify-between select-none shrink-0"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700 tracking-tight truncate max-w-[400px]">
              {title}
            </span>
            <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
              ({Math.round(dimensions.width)}×{Math.round(dimensions.height)})
            </span>
          </div>

          <div className="flex items-center gap-1 text-slate-500">
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1.5 hover:text-slate-800 hover:bg-slate-200/80 rounded transition-colors"
              title="Minimize"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-1.5 hover:text-slate-800 hover:bg-slate-200/80 rounded transition-colors"
              title={isMaximized ? "Restore size" : "Maximize"}
            >
              {isMaximized ? (
                <Copy className="w-3.5 h-3.5" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:text-red-600 hover:bg-red-50 rounded transition-colors ml-1"
              title="Close composer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Composer Content */}
        <div className="flex-1 overflow-hidden flex flex-col bg-white">
          {children}
        </div>
      </div>
    </div>
  );
}
