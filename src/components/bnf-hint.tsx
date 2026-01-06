'use client';

import { useState, useEffect } from 'react';
import { ExternalLink, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface BnfHintProps {
  displayName: string;
  codeSystem: string;
}

interface BnfSection {
  code: string; // Display code (e.g., "2.8.2")
  urlCode: string; // Zero-padded URL code (e.g., "020802")
  name: string;
}

/**
 * Checks OpenPrescribing BNF page for sections matching the display name
 * Only shows hint for SCT_DRGGRP codes that failed to match
 * Uses server-side API proxy to avoid CORS issues
 */
export function BnfHint({ displayName, codeSystem }: BnfHintProps) {
  const [bnfMatch, setBnfMatch] = useState<BnfSection | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    // Only check for SCT_DRGGRP codes
    if (codeSystem !== 'SCT_DRGGRP') {
      return;
    }

    // Check BNF sections via our API proxy
    const checkBnf = async () => {
      setIsChecking(true);
      try {
        const response = await fetch(`/api/bnf-check?displayName=${encodeURIComponent(displayName)}`, {
          signal: AbortSignal.timeout(5000),
        });
        
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        
        if (data.match) {
          setBnfMatch(data.match);
        }
      } catch (error) {
        // Silently fail - this is just a hint
        console.debug('BNF hint check failed:', error);
      } finally {
        setIsChecking(false);
      }
    };

    checkBnf();
  }, [displayName, codeSystem]);

  // Only show hint if we found a match and it's SCT_DRGGRP
  if (codeSystem !== 'SCT_DRGGRP' || !bnfMatch) {
    return null;
  }

  return (
    <Alert className="mt-2 border-blue-200 bg-blue-50/50">
      <Info className="h-4 w-4 text-blue-600" />
      <AlertDescription className="text-xs text-blue-900">
        <span className="font-medium">BNF Section Found:</span> Found matching BNF section "{bnfMatch.name}" (BNF {bnfMatch.code}).{' '}
        <a
          href={`https://openprescribing.net/bnf/${bnfMatch.urlCode}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 underline font-medium"
        >
          View on OpenPrescribing
          <ExternalLink className="h-3 w-3" />
        </a>
      </AlertDescription>
    </Alert>
  );
}

