'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { doc, onSnapshot, updateDoc, setDoc, collection, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getTodayString, formatCurrency, getStatus, getStatusColor, getRandomColor, debounce } from '@/lib/utils';
import { ArrowLeft, Plus, Trash2, Save, Users, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

export default function CaixaPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const caixaId = parseInt(params.caixaId);
  const [selectedDate, setSelectedDate] = useState(searchParams.get('data') || getTodayString());
  
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Estados do formulário
  const [saldoInicial, setSaldoInicial] = useState(0);
  const [valorMaquina, setValorMaquina] = useState(0);
  const [observacoes, setObservacoes] = useState('');
  const [movimentacoes, setMovimentacoes] = useState([]);
  
  // Estados para adicionar movimentação
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMovimentacao, setNewMovimentacao] = useState({
    tipo: 'suprimento',
    descricao: '',
    valor: 0
  });
  
  // Sistema de presença
  const [userName, setUserName] = useState('');
  const [userId, setUserId] = useState('');
  const [userColor, setUserColor] = useState('');
  const [activeUsers, setActiveUsers] = useState([]);
  
  const debounceTimeoutRef = useRef(null);

  // Inicializar usuário
  useEffect(() => {
    let localUserId = localStorage.getItem('loteria_user_id');
    let localUserName = localStorage.getItem('loteria_user_name');
    let localUserColor = localStorage.getItem('loteria_user_color');

    if (!localUserId) {
      localUserId = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('loteria_user_id', localUserId);
    }
    setUserId(localUserId);

    if (!localUserName) {
      localUserName = prompt("Digite seu nome para acessar o sistema:") || `Usuário-${localUserId.substring(0, 4)}`;
      localStorage.setItem('loteria_user_name', localUserName);
    }
    setUserName(localUserName);

    if (!localUserColor) {
      localUserColor = getRandomColor();
      localStorage.setItem('loteria_user_color', localUserColor);
    }
    setUserColor(localUserColor);
  }, []);

  // Escutar dados do dia selecionado
  useEffect(() => {
    if (!selectedDate) return;

    const docRef = doc(db, 'loteria-dias', selectedDate);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const docData = docSnap.data();
        const caixaKey = `caixa${caixaId}`;
        const caixaData = docData.caixas?.[caixaKey] || {};
        const caixaMovimentacoes = docData.movimentacoes?.[caixaKey] || [];

        setData(docData);
        setSaldoInicial(caixaData.saldoInicial || 500);
        setValorMaquina(caixaData.valorMaquina || 0);
        setObservacoes(caixaData.observacoes || '');
        setMovimentacoes(caixaMovimentacoes);
      } else {
        // Criar documento inicial
        const initialData = {
          data: selectedDate,
          caixas: {},
          movimentacoes: {},
          consolidacao: {
            totalSuprimentos: 0,
            totalSangrias: 0,
            saldoTotal: 0
          },
          lastUpdated: serverTimestamp()
        };

        for (let i = 1; i <= 6; i++) {
          initialData.caixas[`caixa${i}`] = {
            saldoInicial: 500,
            valorMaquina: 0,
            observacoes: ''
          };
          initialData.movimentacoes[`caixa${i}`] = [];
        }

        setDoc(docRef, initialData);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [selectedDate, caixaId]);

  // Sistema de presença
  useEffect(() => {
    if (!userId || !userName || !userColor || !selectedDate) return;

    const presenceRef = doc(db, 'loteria-dias', selectedDate, 'activeUsers', userId);
    
    const updatePresence = async () => {
      try {
        await setDoc(presenceRef, {
          name: userName,
          color: userColor,
          page: `caixa-${caixaId}`,
          lastSeen: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        console.error('Erro ao atualizar presença:', error);
      }
    };

    updatePresence();
    const presenceInterval = setInterval(updatePresence, 15000);

    // Escutar usuários ativos
    const usersCollectionRef = collection(db, 'loteria-dias', selectedDate, 'activeUsers');
    const unsubscribeUsers = onSnapshot(usersCollectionRef, (snapshot) => {
      const users = [];
      const sixtySecondsAgo = new Date(Date.now() - 60000);
      
      snapshot.forEach((userDoc) => {
        const userData = userDoc.data();
        if (userData.lastSeen && userData.lastSeen.toDate && userData.lastSeen.toDate() > sixtySecondsAgo) {
          users.push({ id: userDoc.id, ...userData });
        }
      });
      
      setActiveUsers(users);
    });

    const handleBeforeUnload = async () => {
      try {
        await deleteDoc(presenceRef);
      } catch (error) {
        console.error('Erro ao remover presença:', error);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(presenceInterval);
      unsubscribeUsers();
      handleBeforeUnload();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [userId, userName, userColor, selectedDate, caixaId]);

  // Função para salvar dados com debounce
  const saveData = debounce(async (field, value) => {
    if (!selectedDate) return;
    
    setSaving(true);
    try {
      const docRef = doc(db, 'loteria-dias', selectedDate);
      const caixaKey = `caixa${caixaId}`;
      
      await updateDoc(docRef, {
        [`caixas.${caixaKey}.${field}`]: value,
        lastUpdated: serverTimestamp()
      });
    } catch (error) {
      console.error('Erro ao salvar:', error);
    } finally {
      setSaving(false);
    }
  }, 500);

  // Adicionar movimentação
  const addMovimentacao = async () => {
    if (!newMovimentacao.descricao || !newMovimentacao.valor) return;

    try {
      const docRef = doc(db, 'loteria-dias', selectedDate);
      const caixaKey = `caixa${caixaId}`;
      
      const novaMovimentacao = {
        ...newMovimentacao,
        valor: parseFloat(newMovimentacao.valor),
        timestamp: new Date().toISOString(),
        id: Math.random().toString(36).substring(2, 15)
      };

      const novasMovimentacoes = [...movimentacoes, novaMovimentacao];

      await updateDoc(docRef, {
        [`movimentacoes.${caixaKey}`]: novasMovimentacoes,
        lastUpdated: serverTimestamp()
      });

      setNewMovimentacao({ tipo: 'suprimento', descricao: '', valor: 0 });
      setShowAddModal(false);
    } catch (error) {
      console.error('Erro ao adicionar movimentação:', error);
    }
  };

  // Remover movimentação
  const removeMovimentacao = async (movimentacaoId) => {
    try {
      const docRef = doc(db, 'loteria-dias', selectedDate);
      const caixaKey = `caixa${caixaId}`;
      
      const novasMovimentacoes = movimentacoes.filter(mov => mov.id !== movimentacaoId);

      await updateDoc(docRef, {
        [`movimentacoes.${caixaKey}`]: novasMovimentacoes,
        lastUpdated: serverTimestamp()
      });
    } catch (error) {
      console.error('Erro ao remover movimentação:', error);
    }
  };

  // Calcular totais
  const suprimentos = movimentacoes
    .filter(mov => mov.tipo === 'suprimento')
    .reduce((sum, mov) => sum + (mov.valor || 0), 0);
  
  const sangrias = movimentacoes
    .filter(mov => mov.tipo === 'sangria')
    .reduce((sum, mov) => sum + (mov.valor || 0), 0);

  const saldoCalculado = saldoInicial + suprimentos - sangrias;
  const diferenca = valorMaquina - saldoCalculado;
  const status = getStatus(diferenca);

  // Navegação de data
  const navigateDate = (direction) => {
    const currentDate = new Date(selectedDate);
    currentDate.setDate(currentDate.getDate() + direction);
    const newDate = currentDate.toISOString().split('T')[0];
    setSelectedDate(newDate);
    router.push(`/caixa/${caixaId}?data=${newDate}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="loading-spinner"></div>
        <span className="ml-3 text-gray-600">Carregando caixa...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push(`/?data=${selectedDate}`)}
                className="flex items-center text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="h-5 w-5 mr-2" />
                Voltar
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Caixa {caixaId}</h1>
                <p className="text-sm text-gray-600">Controle Individual</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              {/* Navegação de Data */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => navigateDate(-1)}
                  className="p-2 text-gray-500 hover:text-gray-700"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex items-center space-x-2">
                  <Calendar className="h-5 w-5 text-gray-500" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      router.push(`/caixa/${caixaId}?data=${e.target.value}`);
                    }}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={() => navigateDate(1)}
                  className="p-2 text-gray-500 hover:text-gray-700"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              {/* Status de Salvamento */}
              {saving && (
                <div className="flex items-center text-sm text-gray-600">
                  <div className="loading-spinner w-4 h-4 mr-2"></div>
                  Salvando...
                </div>
              )}

              {/* Usuário Atual */}
              <div className="flex items-center space-x-2">
                <div 
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: userColor }}
                ></div>
                <span className="text-sm font-medium text-gray-700">{userName}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Conteúdo Principal */}
          <div className="lg:col-span-3">
            {/* Card de Status */}
            <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Status do Caixa</h2>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(status)}`}>
                  {status}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Saldo Inicial
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={saldoInicial}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value) || 0;
                      setSaldoInicial(value);
                      saveData('saldoInicial', value);
                    }}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Valor da Máquina
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={valorMaquina}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value) || 0;
                      setValorMaquina(value);
                      saveData('valorMaquina', value);
                    }}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Observações
                  </label>
                  <input
                    type="text"
                    value={observacoes}
                    onChange={(e) => {
                      setObservacoes(e.target.value);
                      saveData('observacoes', e.target.value);
                    }}
                    placeholder="Observações do dia..."
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Resumo Financeiro */}
              <div className="mt-6 pt-6 border-t">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                  <div>
                    <p className="text-sm text-gray-600">Saldo Inicial</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(saldoInicial)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Suprimentos</p>
                    <p className="text-lg font-bold text-green-600">+{formatCurrency(suprimentos)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Sangrias</p>
                    <p className="text-lg font-bold text-red-600">-{formatCurrency(sangrias)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Saldo Calculado</p>
                    <p className="text-lg font-bold text-blue-600">{formatCurrency(saldoCalculado)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Diferença</p>
                    <p className={`text-lg font-bold ${diferenca >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(diferenca)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Movimentações */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Movimentações</h2>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Suprimentos */}
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                    <div className="w-4 h-4 bg-green-500 rounded mr-2"></div>
                    Suprimentos
                  </h3>
                  <div className="space-y-3">
                    {movimentacoes
                      .filter(mov => mov.tipo === 'suprimento')
                      .map((mov) => (
                        <div key={mov.id} className="movimentacao-suprimento">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{mov.descricao}</p>
                              <p className="text-sm text-gray-600">
                                {new Date(mov.timestamp).toLocaleString('pt-BR')}
                              </p>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-green-600">
                                +{formatCurrency(mov.valor)}
                              </span>
                              <button
                                onClick={() => removeMovimentacao(mov.id)}
                                className="text-red-500 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    
                    {movimentacoes.filter(mov => mov.tipo === 'suprimento').length === 0 && (
                      <p className="text-gray-500 italic">Nenhum suprimento registrado</p>
                    )}
                  </div>
                </div>

                {/* Sangrias */}
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                    <div className="w-4 h-4 bg-red-500 rounded mr-2"></div>
                    Sangrias
                  </h3>
                  <div className="space-y-3">
                    {movimentacoes
                      .filter(mov => mov.tipo === 'sangria')
                      .map((mov) => (
                        <div key={mov.id} className="movimentacao-sangria">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{mov.descricao}</p>
                              <p className="text-sm text-gray-600">
                                {new Date(mov.timestamp).toLocaleString('pt-BR')}
                              </p>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-red-600">
                                -{formatCurrency(mov.valor)}
                              </span>
                              <button
                                onClick={() => removeMovimentacao(mov.id)}
                                className="text-red-500 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    
                    {movimentacoes.filter(mov => mov.tipo === 'sangria').length === 0 && (
                      <p className="text-gray-500 italic">Nenhuma sangria registrada</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-6 sticky top-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Users className="h-5 w-5 mr-2" />
                Usuários Ativos ({activeUsers.length})
              </h3>
              
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {activeUsers.map((user) => (
                  <div key={user.id} className="user-presence">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: user.color }}
                    ></div>
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-700 block truncate">
                        {user.name}
                      </span>
                      {user.page && (
                        <span className="text-xs text-gray-500">
                          {user.page}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                
                {activeUsers.length === 0 && (
                  <p className="text-sm text-gray-500 italic">Nenhum usuário ativo</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal para Adicionar Movimentação */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Adicionar Movimentação
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tipo
                </label>
                <select
                  value={newMovimentacao.tipo}
                  onChange={(e) => setNewMovimentacao({...newMovimentacao, tipo: e.target.value})}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="suprimento">Suprimento</option>
                  <option value="sangria">Sangria</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Descrição
                </label>
                <input
                  type="text"
                  value={newMovimentacao.descricao}
                  onChange={(e) => setNewMovimentacao({...newMovimentacao, descricao: e.target.value})}
                  placeholder="Ex: 09:00 - Abertura do caixa"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Valor
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={newMovimentacao.valor}
                  onChange={(e) => setNewMovimentacao({...newMovimentacao, valor: parseFloat(e.target.value) || 0})}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={addMovimentacao}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center"
              >
                <Save className="h-4 w-4 mr-2" />
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

