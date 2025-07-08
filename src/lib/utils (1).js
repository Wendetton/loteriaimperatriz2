import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind and class names.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Formata um número como moeda brasileira.
 */
export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2
  }).format(value);
}

/**
 * Retorna a data de hoje no formato YYYY-MM-DD.
 */
export function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Define status com base na diferença.
 */
export function getStatus(diff) {
  return diff >= 0 ? 'No Azul' : 'No Vermelho';
}

/**
 * Retorna classes de cor para o status.
 */
export function getStatusColor(status) {
  const lower = status.toLowerCase();
  if (lower.includes('azul')) return 'bg-green-100 text-green-800';
  if (lower.includes('vermelho')) return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-800';
}

/**
 * Gera uma cor hex aleatória.
 */
export function getRandomColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

/**
 * Debounce: atrasa a execução da função até que pare de ser chamada.
 */
export function debounce(fn, delay = 300) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}
