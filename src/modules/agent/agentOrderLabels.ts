// Les libellés des ordres de l'agent vivent dans `src/lib` (OROS5.39) : la fiche d'une proposition les lit, et la fiche ne
// lit aucun module (tests/design-guard.test.ts, OROS5.4).
export { originLabel, outcomeLabel, refusalLabel } from '@/lib/agentOrderLabels';
