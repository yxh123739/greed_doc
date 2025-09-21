"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageCircle, Sparkles } from "lucide-react";
import { KnowledgeChat } from "./knowledge-chat";

export function FloatingChatButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <>
      {/* Floating button */}
      <div className="fixed bottom-6 right-6 z-50">
        <div className="relative">
          {/* Tooltip bubble */}
          {isHovered && !isOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-48 p-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 animate-in slide-in-from-bottom-2 duration-200">
              <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                💡 LEED Smart Assistant
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                Upload documents for professional advice
              </div>
              {/* Small arrow */}
              <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-white dark:border-t-gray-800"></div>
            </div>
          )}

          {/* Main button */}
          <Button
            onClick={() => setIsOpen(true)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="w-16 h-16 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 bg-gradient-to-r from-primary to-primary/90 hover:scale-110 relative overflow-hidden group"
            size="lg"
          >
            {/* Background animation effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 animate-pulse"></div>

            {/* Icon container */}
            <div className="relative z-10 flex items-center justify-center">
              <MessageCircle className="h-7 w-7 text-white transition-transform duration-300 group-hover:scale-110" />

              {/* Twinkling star effect */}
              <Sparkles className="absolute -top-1 -right-1 h-4 w-4 text-yellow-300 animate-pulse" />
            </div>

            {/* Pulsing animation ring */}
            <div className="absolute inset-0 rounded-full border-2 border-white/30 animate-ping"></div>
          </Button>

          {/* Small red notification dot (optional) */}
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
          </div>
        </div>
      </div>

      {/* Chat dialog */}
      <KnowledgeChat open={isOpen} onOpenChange={setIsOpen} />

      {/* Global styles */}
      <style jsx>{`
        @keyframes float {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
          }
        }
        .floating-button {
          animation: float 3s ease-in-out infinite;
        }
      `}</style>
    </>
  );
}
