
import { supabase, configurado } from "./supabase.js";

const $ = (id) => document.getElementById(id);

function mostrarMensagem(id, texto, erro = false) {
    const elemento = $(id);
    if (!elemento) return;

    elemento.textContent = texto;
    elemento.classList.toggle("error", erro);
}

function dinheiro(valor) {
    return Number(valor).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });
}

function dataHoje() {
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, "0");
    const dia = String(agora.getDate()).padStart(2, "0");

    return `${ano}-${mes}-${dia}`;
}

function formatarData(data) {
    const [ano, mes, dia] = String(data).slice(0, 10).split("-");
    return `${dia}/${mes}/${ano}`;
}

function formatarHorario(data) {
    return new Date(data).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function escapar(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, caractere => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[caractere]);
}

async function usuarioAtual() {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user;
}

async function exigirLogin() {
    const usuario = await usuarioAtual();

    if (!usuario) {
        location.href = "login.html";
        return null;
    }

    return usuario;
}

async function exigirAdmin() {
    const usuario = await exigirLogin();
    if (!usuario) return null;

    const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", usuario.id)
        .single();

    if (error || data.role !== "admin") {
        alert("Você não tem permissão para acessar essa página.");
        location.href = "index.html";
        return null;
    }

    return usuario;
}

// BOTÃO SAIR

document.querySelectorAll("#logout").forEach(botao => {
    botao.addEventListener("click", async () => {
        await supabase.auth.signOut();
        location.href = "index.html";
    });
});

// CARREGAR SERVIÇOS DA PÁGINA INICIAL

async function carregarServicosInicio() {
    const container = $("home-services");
    if (!container) return;

    const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("active", true)
        .order("name");

    if (error) {
        container.innerHTML = "<p>Não foi possível carregar os serviços.</p>";
        return;
    }

    if (!data.length) {
        container.innerHTML = "<p>Nenhum serviço cadastrado.</p>";
        return;
    }

    container.innerHTML = data.map(servico => `
        <article class="card">
            <h3>${escapar(servico.name)}</h3>
            <p class="service-price">${dinheiro(servico.price)}</p>
            <p>${servico.duration_minutes} minutos</p>
            <a class="btn service-book-btn" href="cadastro.html">FAZER CADASTRO E AGENDAR</a>
        </article>
    `).join("");
}

// CADASTRO

const cadastroForm = $("signup-form");

if (cadastroForm) {
    cadastroForm.addEventListener("submit", async evento => {
        evento.preventDefault();

        if (!configurado) {
            mostrarMensagem("message", "Configure o Supabase primeiro.", true);
            return;
        }

        const nome = $("name").value.trim();
        const telefone = $("phone").value.trim();
        const email = $("email").value.trim().toLowerCase();
        const senha = $("password").value;

        if (nome.length < 3) {
            mostrarMensagem("message", "Digite seu nome completo.", true);
            return;
        }

        if (telefone.replace(/\D/g, "").length < 10) {
            mostrarMensagem("message", "Digite um telefone válido.", true);
            return;
        }

        if (senha.length < 6) {
            mostrarMensagem("message", "A senha precisa ter pelo menos 6 caracteres.", true);
            return;
        }

        const botao = cadastroForm.querySelector("button[type=submit]");
        botao.disabled = true;

        mostrarMensagem("message", "Criando sua conta...");

        const paginaConfirmacao = new URL(
            "./login.html",
            window.location.href
        ).href;

        const { error } = await supabase.auth.signUp({
            email,
            password: senha,
            options: {
                emailRedirectTo: paginaConfirmacao,
                data: {
                    full_name: nome,
                    phone: telefone
                }
            }
        });

        botao.disabled = false;

        if (error) {
            mostrarMensagem("message", error.message, true);
            return;
        }

        mostrarMensagem(
            "message",
            "Cadastro realizado! Enviamos um link para seu e-mail. Abra a mensagem, clique em “Confirmar e-mail” e depois volte à página Entrar. Confira também a caixa de spam."
        );
    });
}

// LOGIN

const loginForm = $("login-form");

if (loginForm) {
    loginForm.addEventListener("submit", async evento => {
        evento.preventDefault();

        if (!configurado) {
            mostrarMensagem("message", "Configure o Supabase primeiro.", true);
            return;
        }

        const identificador = $("identifier").value.trim();
        const senha = $("password").value;

        const botao = loginForm.querySelector("button[type=submit]");
        botao.disabled = true;

        mostrarMensagem("message", "Entrando...");

        let resultado;

        if (identificador.includes("@")) {
            resultado = await supabase.auth.signInWithPassword({
                email: identificador.toLowerCase(),
                password: senha
            });
        } else {
            const { data, error } = await supabase.functions.invoke(
                "login-telefone",
                {
                    body: {
                        phone: identificador,
                        password: senha
                    }
                }
            );

            if (error) {
                resultado = { error };
            } else if (data?.access_token && data?.refresh_token) {
                resultado = await supabase.auth.setSession({
                    access_token: data.access_token,
                    refresh_token: data.refresh_token
                });
            } else {
                resultado = {
                    error: new Error(data?.error || "Não foi possível entrar.")
                };
            }
        }

        botao.disabled = false;

        if (resultado.error) {
            const erro = resultado.error.message || "";

            if (/email not confirmed|email_not_confirmed/i.test(erro)) {
                mostrarMensagem(
                    "message",
                    "Sua conta ainda precisa ser confirmada. Confira o e-mail usado no cadastro e a pasta de spam.",
                    true
                );
            } else {
                console.error("Erro no login:", resultado.error);
                mostrarMensagem(
                    "message",
                    "Não foi possível entrar. Confira seu e-mail e sua senha.",
                    true
                );
            }
            return;
        }

        const usuario = resultado.data.user;

        const { data: perfil } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", usuario.id)
            .single();

        if (perfil?.role === "admin") {
            location.href = "admin.html";
        } else {
            location.href = "agendamento.html";
        }
    });
}

// RECUPERAR SENHA

const recuperarSenha = $("forgot-password");

if (recuperarSenha) {
    recuperarSenha.addEventListener("click", async evento => {
        evento.preventDefault();

        if (!configurado) {
            mostrarMensagem("message", "Supabase não configurado.", true);
            return;
        }

        const email = $("identifier").value.trim().toLowerCase();

        if (!email || !email.includes("@")) {
            mostrarMensagem(
                "message",
                "Digite seu e-mail no campo acima para recuperar a senha.",
                true
            );
            $("identifier").focus();
            return;
        }

        mostrarMensagem("message", "Enviando e-mail de recuperação...");

        const paginaRecuperacao = new URL(
            "./redefinir-senha.html",
            window.location.href
        ).href;

        const { error } = await supabase.auth.resetPasswordForEmail(
            email,
            {
                redirectTo: paginaRecuperacao
            }
        );

        if (error) {
            console.error("Erro ao recuperar senha:", error);

            mostrarMensagem(
                "message",
                "Erro: " + error.message,
                true
            );
            return;
        }

        mostrarMensagem(
            "message",
            "Se esse e-mail estiver cadastrado, você receberá um link para redefinir sua senha."
        );
    });
}

// SALVAR NOVA SENHA

const updatePasswordForm = $("update-password-form");

if (updatePasswordForm) {
    updatePasswordForm.addEventListener("submit", async evento => {
        evento.preventDefault();

        const senha = $("new-password").value;
        const confirmar = $("confirm-password").value;

        if (senha.length < 6) {
            mostrarMensagem(
                "message",
                "A senha precisa ter pelo menos 6 caracteres.",
                true
            );
            return;
        }

        if (senha !== confirmar) {
            mostrarMensagem(
                "message",
                "As senhas não são iguais.",
                true
            );
            return;
        }

        const botao = updatePasswordForm.querySelector("button[type=submit]");
        botao.disabled = true;

        mostrarMensagem("message", "Salvando nova senha...");

        const { error } = await supabase.auth.updateUser({
            password: senha
        });

        botao.disabled = false;

        if (error) {
            mostrarMensagem(
                "message",
                "Não foi possível alterar a senha. Solicite um novo link de recuperação.",
                true
            );
            return;
        }

        mostrarMensagem("message", "Senha alterada com sucesso!");

        setTimeout(() => {
            location.href = "login.html";
        }, 2000);
    });
}

// ==========================================
// AGENDAMENTO COM CALENDÁRIO VISUAL
// ==========================================

let mesAtual = new Date();
mesAtual.setDate(1);

let dataSelecionada = "";
let horarioSelecionado = "";

// CRIAR DATA NO FORMATO LOCAL

function dataLocal(ano, mes, dia) {
    return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

// ATUALIZAR RESUMO

function atualizarResumo() {
    const servico = $("service");
    if (!servico) return;

    const opcao = servico.selectedOptions[0];

    const resumoServico = $("summary-service");
    const resumoData = $("summary-date");
    const resumoHorario = $("summary-time");

    if (resumoServico) {
        resumoServico.textContent =
            "Serviço: " + (servico.value ? opcao.textContent : "não selecionado");
    }

    if (resumoData) {
        resumoData.textContent =
            "Data: " + (dataSelecionada ? formatarData(dataSelecionada) : "não selecionada");
    }

    if (resumoHorario) {
        resumoHorario.textContent =
            "Horário: " + (horarioSelecionado || "não selecionado");
    }
}

// CARREGAR SERVIÇOS NO AGENDAMENTO

async function carregarServicosAgendamento() {
    const select = $("service");
    if (!select) return;

    const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("active", true)
        .order("name");

    if (error) {
        select.innerHTML = '<option value="">Erro ao carregar</option>';
        return;
    }

    select.innerHTML = '<option value="">Selecione um serviço</option>';

    data.forEach(servico => {
        const opcao = document.createElement("option");

        opcao.value = servico.id;
        opcao.textContent =
            `${servico.name} - ${dinheiro(servico.price)} - ${servico.duration_minutes} min`;

        select.appendChild(opcao);
    });

    renderizarCalendario();
    atualizarResumo();
}

// MOSTRAR PREÇO E DURAÇÃO

async function mostrarInfoServico() {
    const select = $("service");
    if (!select) return;

    const id = select.value;

    if (!id) {
        $("service-info").textContent = "";

        dataSelecionada = "";
        horarioSelecionado = "";

        $("date").value = "";
        $("time").value = "";

        $("time-slots").innerHTML = "";
        $("time-instruction").textContent =
            "Primeiro escolha um serviço e uma data.";

        renderizarCalendario();
        atualizarResumo();
        return;
    }

    const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("id", id)
        .single();

    if (error) {
        mostrarMensagem("message", "Não foi possível carregar o serviço.", true);
        return;
    }

    if (data) {
        $("service-info").textContent =
            `Preço: ${dinheiro(data.price)} | Duração: ${data.duration_minutes} minutos`;
    }

    atualizarResumo();

    if (dataSelecionada) {
        await carregarHorarios();
    }
}

if ($("service")) {
    $("service").addEventListener("change", mostrarInfoServico);
}

// DESENHAR CALENDÁRIO

function renderizarCalendario() {
    const calendario = $("calendar-days");
    const titulo = $("calendar-month");

    if (!calendario || !titulo) return;

    const ano = mesAtual.getFullYear();
    const mes = mesAtual.getMonth();

    const primeiroDia = new Date(ano, mes, 1).getDay();
    const ultimoDia = new Date(ano, mes + 1, 0).getDate();

    titulo.textContent = mesAtual.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric"
    });

    calendario.innerHTML = "";

    // ESPAÇOS ANTES DO PRIMEIRO DIA

    for (let i = 0; i < primeiroDia; i++) {
        const vazio = document.createElement("span");
        vazio.className = "calendar-empty";
        calendario.appendChild(vazio);
    }

    const hoje = dataHoje();

    // CRIAR OS DIAS DO MÊS

    for (let dia = 1; dia <= ultimoDia; dia++) {
        const data = dataLocal(ano, mes, dia);

        const botao = document.createElement("button");
        botao.type = "button";
        botao.textContent = dia;
        botao.className = "calendar-day";

        if (data < hoje) {
            botao.disabled = true;
        }

        if (data === dataSelecionada) {
            botao.classList.add("selected");
        }

        botao.addEventListener("click", async () => {
            dataSelecionada = data;
            horarioSelecionado = "";

            $("date").value = data;
            $("time").value = "";

            renderizarCalendario();
            atualizarResumo();

            await carregarHorarios();
        });

        calendario.appendChild(botao);
    }
}

// MÊS ANTERIOR

if ($("prev-month")) {
    $("prev-month").addEventListener("click", () => {
        const hoje = new Date();
        hoje.setDate(1);
        hoje.setHours(0, 0, 0, 0);

        const anterior = new Date(
            mesAtual.getFullYear(),
            mesAtual.getMonth() - 1,
            1
        );

        if (anterior >= hoje) {
            mesAtual = anterior;
            renderizarCalendario();
        }
    });
}

// PRÓXIMO MÊS

if ($("next-month")) {
    $("next-month").addEventListener("click", () => {
        mesAtual = new Date(
            mesAtual.getFullYear(),
            mesAtual.getMonth() + 1,
            1
        );

        renderizarCalendario();
    });
}

// BUSCAR HORÁRIOS DISPONÍVEIS

async function carregarHorarios() {
    const data = $("date")?.value;
    const servico = $("service")?.value;
    const container = $("time-slots");
    const instrucao = $("time-instruction");

    if (!container || !instrucao) return;

    container.innerHTML = "";
    horarioSelecionado = "";

    if ($("time")) {
        $("time").value = "";
    }

    atualizarResumo();

    if (!data || !servico) {
        instrucao.textContent =
            "Primeiro escolha um serviço e uma data.";
        return;
    }

    instrucao.textContent = "Buscando horários disponíveis...";

    const { data: horarios, error } = await supabase.rpc(
        "get_available_slots",
        {
            p_date: data,
            p_service_id: servico
        }
    );

    if (error) {
        instrucao.textContent =
            "Não foi possível carregar os horários.";

        console.error("Erro ao buscar horários:", error);
        return;
    }

    if (!horarios || horarios.length === 0) {
        instrucao.textContent =
            "Não há horários disponíveis nessa data.";
        return;
    }

    instrucao.textContent =
        "Selecione um dos horários disponíveis:";

    horarios.forEach(item => {
        const hora = String(item.slot_time).slice(0, 5);

        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "time-button";
        botao.textContent = hora;

        botao.addEventListener("click", () => {
            horarioSelecionado = hora;
            $("time").value = hora;

            document.querySelectorAll(".time-button").forEach(outro => {
                outro.classList.remove("selected");
            });

            botao.classList.add("selected");

            atualizarResumo();
        });

        container.appendChild(botao);
    });
}


const fecharConfirmacao = $("close-success");
if (fecharConfirmacao) {
    fecharConfirmacao.addEventListener("click", () => {
        $("booking-success").hidden = true;
    });
}

const fundoConfirmacao = $("booking-success");
if (fundoConfirmacao) {
    fundoConfirmacao.addEventListener("click", evento => {
        if (evento.target === fundoConfirmacao) {
            fundoConfirmacao.hidden = true;
        }
    });
}

// CONFIRMAR AGENDAMENTO

const bookingForm = $("booking-form");

if (bookingForm) {
    bookingForm.addEventListener("submit", async evento => {
        evento.preventDefault();

        const usuario = await exigirLogin();
        if (!usuario) return;

        const serviceId = $("service").value;
        const date = $("date").value;
        const time = $("time").value;

        if (!serviceId || !date || !time) {
            mostrarMensagem(
                "message",
                "Escolha o serviço, a data e o horário.",
                true
            );
            return;
        }

        const botao = bookingForm.querySelector("button[type=submit]");
        botao.disabled = true;

        mostrarMensagem("message", "Confirmando seu agendamento...");

        const { error } = await supabase.rpc("create_booking", {
            p_service_id: serviceId,
            p_date: date,
            p_time: time
        });

        botao.disabled = false;

        if (error) {
            mostrarMensagem("message", error.message, true);
            await carregarHorarios();
            return;
        }

        // Abre a página separada de agradecimento após confirmar no banco.
        window.location.href = "agradecimento.html";
        return;

        dataSelecionada = "";
        horarioSelecionado = "";

        $("date").value = "";
        $("time").value = "";

        $("time-slots").innerHTML = "";
        $("time-instruction").textContent =
            "Primeiro escolha um serviço e uma data.";

        $("service-info").textContent = "";

        renderizarCalendario();
        atualizarResumo();
    });
}

// ==========================================
// MEUS AGENDAMENTOS
// ==========================================

async function carregarMeusAgendamentos() {
    const container = $("my-bookings");
    if (!container) return;

    const usuario = await exigirLogin();
    if (!usuario) return;

    const { data, error } = await supabase
        .from("appointments")
        .select(`
            id,
            start_at,
            end_at,
            status,
            services(name, price)
        `)
        .eq("customer_id", usuario.id)
        .order("start_at", { ascending: true });

    if (error) {
        container.textContent = "Erro ao carregar agendamentos.";
        return;
    }

    if (!data.length) {
        container.innerHTML = `
            <p>Você ainda não possui agendamentos.</p>
            <a class="btn" href="agendamento.html">AGENDAR AGORA</a>
        `;
        return;
    }

    container.innerHTML = data.map(item => {
        const podeCancelar =
            item.status === "pending" ||
            item.status === "confirmed";

        return `
            <article class="item">
                <strong>${escapar(item.services?.name || "Serviço")}</strong>
                <p>Data: ${formatarData(item.start_at)}</p>
                <p>Horário: ${formatarHorario(item.start_at)}</p>
                <p>Preço: ${dinheiro(item.services?.price || 0)}</p>
                <p>Status: ${escapar(item.status)}</p>

                ${podeCancelar ? `
                    <button
                        class="btn danger small"
                        data-cancel="${item.id}"
                    >
                        CANCELAR
                    </button>
                ` : ""}
            </article>
        `;
    }).join("");

    container.querySelectorAll("[data-cancel]").forEach(botao => {
        botao.addEventListener("click", async () => {
            if (!confirm("Deseja cancelar este agendamento?")) return;

            const { error } = await supabase.rpc("cancel_booking", {
                p_appointment_id: botao.dataset.cancel
            });

            if (error) {
                alert(error.message);
            } else {
                alert("Agendamento cancelado.");
                await carregarMeusAgendamentos();
            }
        });
    });
}

// ADMIN: AGENDA DO DIA

async function carregarAgendaAdmin() {
    const container = $("admin-bookings");
    if (!container) return;

    const usuario = await exigirAdmin();
    if (!usuario) return;

    const dataEscolhida = $("admin-date").value || dataHoje();

    const inicio = new Date(`${dataEscolhida}T00:00:00-03:00`);
    const fim = new Date(`${dataEscolhida}T00:00:00-03:00`);

    fim.setDate(fim.getDate() + 1);

    const { data, error } = await supabase
        .from("appointments")
        .select(`
            id,
            start_at,
            end_at,
            status,
            profiles!appointments_customer_id_fkey(full_name, phone),
            services(name, price)
        `)
        .gte("start_at", inicio.toISOString())
        .lt("start_at", fim.toISOString())
        .order("start_at");

    if (error) {
        container.textContent = "Erro ao carregar agenda: " + error.message;
        return;
    }

    if (!data.length) {
        container.innerHTML = "<p>Nenhum agendamento nessa data.</p>";
        return;
    }

    container.innerHTML = data.map(item => `
        <article class="item">
            <strong>${formatarHorario(item.start_at)}</strong>
            <p>Cliente: ${escapar(item.profiles?.full_name)}</p>
            <p>Telefone: ${escapar(item.profiles?.phone)}</p>
            <p>Serviço: ${escapar(item.services?.name)}</p>
            <p>Preço: ${dinheiro(item.services?.price || 0)}</p>
            <p>Status: ${escapar(item.status)}</p>

            <div class="actions">
                <button class="btn small" data-status="${item.id}" data-value="confirmed">CONFIRMAR</button>
                <button class="btn small" data-status="${item.id}" data-value="completed">CONCLUIR</button>
                <button class="btn danger small" data-status="${item.id}" data-value="cancelled">CANCELAR</button>
            </div>
        </article>
    `).join("");

    container.querySelectorAll("[data-status]").forEach(botao => {
        botao.addEventListener("click", async () => {
            const { error } = await supabase
                .from("appointments")
                .update({ status: botao.dataset.value })
                .eq("id", botao.dataset.status);

            if (error) {
                alert(error.message);
            } else {
                await carregarAgendaAdmin();
            }
        });
    });
}

if ($("admin-date")) {
    $("admin-date").value = dataHoje();
}

if ($("load-admin")) {
    $("load-admin").addEventListener("click", carregarAgendaAdmin);
}

// ADMIN: SERVIÇOS

async function carregarServicosAdmin() {
    const container = $("admin-services");
    if (!container) return;

    const { data, error } = await supabase
        .from("services")
        .select("*")
        .order("name");

    if (error) {
        container.textContent = "Erro ao carregar serviços.";
        return;
    }

    container.innerHTML = data.map(servico => `
        <article class="item">
            <strong>${escapar(servico.name)}</strong>
            <p>${dinheiro(servico.price)}</p>
            <p>${servico.duration_minutes} minutos</p>
            <p>${servico.active ? "Ativo" : "Desativado"}</p>

            <button
                class="btn small"
                data-service-toggle="${servico.id}"
                data-active="${servico.active}"
            >
                ${servico.active ? "DESATIVAR" : "ATIVAR"}
            </button>
        </article>
    `).join("");

    container.querySelectorAll("[data-service-toggle]").forEach(botao => {
        botao.addEventListener("click", async () => {
            const novoEstado = botao.dataset.active !== "true";

            const { error } = await supabase
                .from("services")
                .update({ active: novoEstado })
                .eq("id", botao.dataset.serviceToggle);

            if (error) {
                alert(error.message);
            } else {
                await carregarServicosAdmin();
            }
        });
    });
}

const serviceForm = $("service-form");

if (serviceForm) {
    serviceForm.addEventListener("submit", async evento => {
        evento.preventDefault();

        const usuario = await exigirAdmin();
        if (!usuario) return;

        const nome = $("service-name").value.trim();
        const preco = Number($("service-price").value);
        const duracao = Number($("service-duration").value);

        if (!nome || preco < 0 || duracao < 5) {
            mostrarMensagem("service-message", "Confira os dados.", true);
            return;
        }

        const { error } = await supabase
            .from("services")
            .insert({
                name: nome,
                price: preco,
                duration_minutes: duracao,
                active: true
            });

        if (error) {
            mostrarMensagem("service-message", error.message, true);
            return;
        }

        serviceForm.reset();
        mostrarMensagem("service-message", "Serviço cadastrado!");
        await carregarServicosAdmin();
    });
}

// ADMIN: HORÁRIOS DE FUNCIONAMENTO

const dias = [
    "Domingo",
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado"
];

async function carregarHorariosAdmin() {
    const container = $("hours-fields");
    if (!container) return;

    const { data, error } = await supabase
        .from("business_hours")
        .select("*")
        .order("weekday");

    if (error) {
        container.textContent = "Erro ao carregar horários.";
        return;
    }

    container.innerHTML = dias.map((dia, indice) => {
        const horario = data.find(item => item.weekday === indice);

        return `
            <div class="hours-row">
                <label class="check-label">
                    <input
                        type="checkbox"
                        id="open-${indice}"
                        ${horario?.is_open ? "checked" : ""}
                    >
                    ${dia}
                </label>

                <label>
                    Abre
                    <input
                        type="time"
                        id="start-${indice}"
                        value="${horario?.open_time?.slice(0,5) || "09:00"}"
                    >
                </label>

                <label>
                    Fecha
                    <input
                        type="time"
                        id="end-${indice}"
                        value="${horario?.close_time?.slice(0,5) || "18:00"}"
                    >
                </label>
            </div>
        `;
    }).join("");
}

const hoursForm = $("hours-form");

if (hoursForm) {
    hoursForm.addEventListener("submit", async evento => {
        evento.preventDefault();

        const usuario = await exigirAdmin();
        if (!usuario) return;

        const horarios = [];

        for (let i = 0; i < 7; i++) {
            const aberto = $(`open-${i}`).checked;
            const inicio = $(`start-${i}`).value;
            const fim = $(`end-${i}`).value;

            if (aberto && (!inicio || !fim || inicio >= fim)) {
                mostrarMensagem(
                    "hours-message",
                    `Confira os horários de ${dias[i]}.`,
                    true
                );
                return;
            }

            horarios.push({
                weekday: i,
                is_open: aberto,
                open_time: inicio || "09:00",
                close_time: fim || "18:00"
            });
        }

        const { error } = await supabase
            .from("business_hours")
            .upsert(horarios, { onConflict: "weekday" });

        if (error) {
            mostrarMensagem("hours-message", error.message, true);
        } else {
            mostrarMensagem("hours-message", "Horários salvos!");
        }
    });
}

// ADMIN: BLOQUEAR HORÁRIOS

async function carregarBloqueios() {
    const container = $("blocks-list");
    if (!container) return;

    const { data, error } = await supabase
        .from("blocked_slots")
        .select("*")
        .gte("end_at", new Date().toISOString())
        .order("start_at");

    if (error) {
        container.textContent = "Erro ao carregar bloqueios.";
        return;
    }

    container.innerHTML = data.map(item => `
        <article class="item">
            <strong>Horário bloqueado</strong>
            <p>Início: ${formatarData(item.start_at)} às ${formatarHorario(item.start_at)}</p>
            <p>Fim: ${formatarHorario(item.end_at)}</p>
            <p>Motivo: ${escapar(item.reason || "Não informado")}</p>

            <button class="btn danger small" data-unblock="${item.id}">
                DESBLOQUEAR
            </button>
        </article>
    `).join("");

    container.querySelectorAll("[data-unblock]").forEach(botao => {
        botao.addEventListener("click", async () => {
            if (!confirm("Deseja desbloquear este horário?")) return;

            const { error } = await supabase
                .from("blocked_slots")
                .delete()
                .eq("id", botao.dataset.unblock);

            if (error) {
                alert(error.message);
            } else {
                await carregarBloqueios();
            }
        });
    });
}

const blockForm = $("block-form");

if (blockForm) {
    blockForm.addEventListener("submit", async evento => {
        evento.preventDefault();

        const usuario = await exigirAdmin();
        if (!usuario) return;

        const data = $("block-date").value;
        const inicio = $("block-start").value;
        const fim = $("block-end").value;
        const motivo = $("block-reason").value.trim();

        if (!data || !inicio || !fim || inicio >= fim) {
            mostrarMensagem("block-message", "Confira a data e os horários.", true);
            return;
        }

        const startAt = new Date(`${data}T${inicio}:00-03:00`);
        const endAt = new Date(`${data}T${fim}:00-03:00`);

        const { error } = await supabase
            .from("blocked_slots")
            .insert({
                start_at: startAt.toISOString(),
                end_at: endAt.toISOString(),
                reason: motivo
            });

        if (error) {
            mostrarMensagem("block-message", error.message, true);
            return;
        }

        blockForm.reset();
        mostrarMensagem("block-message", "Horário bloqueado!");
        await carregarBloqueios();
    });
}

// ==========================================
// INICIALIZAÇÃO
// ==========================================

if (!configurado) {
    console.warn("Configure o Supabase no arquivo supabase.js.");
}

if ($("home-services")) {
    carregarServicosInicio();
}

if ($("booking-form")) {
    exigirLogin().then(usuario => {
        if (usuario) {
            carregarServicosAgendamento();
        }
    });
}

if ($("my-bookings")) {
    carregarMeusAgendamentos();
}

if ($("admin-bookings")) {
    exigirAdmin().then(usuario => {
        if (usuario) {
            carregarAgendaAdmin();
            carregarServicosAdmin();
            carregarHorariosAdmin();
            carregarBloqueios();
        }
    });
}
