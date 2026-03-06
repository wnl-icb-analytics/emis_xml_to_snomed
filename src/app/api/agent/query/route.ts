import { NextRequest, NextResponse } from 'next/server';
import { loadAgentDocument } from '@/lib/agent-document-store';
import {
  buildDocumentGraph,
  buildReportIndexEntry,
  buildReportLogicSummary,
  buildReportSearchText,
} from '@/lib/agent-report-utils';
import type { EmisReport } from '@/lib/types';

type AgentQueryAction =
  | 'documentSummary'
  | 'listReports'
  | 'searchReports'
  | 'getReportLogic'
  | 'getImplementationGuide'
  | 'getGraph';

function findReport(reportSelector: string, reports: EmisReport[]) {
  return reports.find((report) =>
    report.id === reportSelector ||
    report.xmlId === reportSelector ||
    report.searchName === reportSelector ||
    report.name === reportSelector
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      documentId?: string;
      action?: AgentQueryAction;
      reportId?: string;
      q?: string;
    };

    if (!body.documentId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: documentId' },
        { status: 400 }
      );
    }
    if (!body.action) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: action' },
        { status: 400 }
      );
    }

    const stored = await loadAgentDocument(body.documentId);
    if (!stored) {
      return NextResponse.json(
        { success: false, error: `Document not found: ${body.documentId}` },
        { status: 404 }
      );
    }

    switch (body.action) {
      case 'documentSummary':
        return NextResponse.json({
          success: true,
          schemaVersion: '1',
          action: body.action,
          document: {
            id: stored.id,
            fileName: stored.fileName,
            createdAt: stored.createdAt,
            parsedAt: stored.data.parsedAt,
            reportCount: stored.data.reports.length,
          },
        });

      case 'listReports':
        return NextResponse.json({
          success: true,
          schemaVersion: '1',
          action: body.action,
          reports: stored.data.reports.map((report) => buildReportIndexEntry(report, stored.data.reports)),
        });

      case 'searchReports': {
        const q = body.q?.trim().toLowerCase();
        if (!q) {
          return NextResponse.json(
            { success: false, error: 'Missing required field for searchReports: q' },
            { status: 400 }
          );
        }
        const results = stored.data.reports
          .filter((report) => buildReportSearchText(report, stored.data.reports).includes(q))
          .map((report) => buildReportIndexEntry(report, stored.data.reports));

        return NextResponse.json({
          success: true,
          schemaVersion: '1',
          action: body.action,
          query: q,
          resultCount: results.length,
          results,
        });
      }

      case 'getReportLogic': {
        if (!body.reportId) {
          return NextResponse.json(
            { success: false, error: 'Missing required field for getReportLogic: reportId' },
            { status: 400 }
          );
        }
        const report = findReport(body.reportId, stored.data.reports);
        if (!report) {
          return NextResponse.json(
            { success: false, error: `Report not found: ${body.reportId}` },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          schemaVersion: '1',
          action: body.action,
          report: buildReportLogicSummary(report, stored.data.reports),
        });
      }

      case 'getImplementationGuide': {
        if (!body.reportId) {
          return NextResponse.json(
            { success: false, error: 'Missing required field for getImplementationGuide: reportId' },
            { status: 400 }
          );
        }
        const report = findReport(body.reportId, stored.data.reports);
        if (!report) {
          return NextResponse.json(
            { success: false, error: `Report not found: ${body.reportId}` },
            { status: 404 }
          );
        }
        const summary = buildReportLogicSummary(report, stored.data.reports);
        return NextResponse.json({
          success: true,
          schemaVersion: '1',
          action: body.action,
          report: {
            id: summary.id,
            xmlId: summary.xmlId,
            title: summary.title,
            searchName: summary.searchName,
            parentPopulation: summary.parentPopulation,
            libraryItems: summary.agentInterpretation.dependencies.libraryItems,
            parentChain: summary.parentChain,
            valueSets: summary.valueSets,
            implementationGuideMarkdown: summary.implementationGuideMarkdown,
          },
        });
      }

      case 'getGraph':
        return NextResponse.json({
          success: true,
          schemaVersion: '1',
          action: body.action,
          graph: buildDocumentGraph(stored.data.reports),
        });

      default:
        return NextResponse.json(
          { success: false, error: `Unsupported action: ${body.action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Agent query failed',
      },
      { status: 500 }
    );
  }
}
