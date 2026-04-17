use mdns_sd::{ServiceDaemon, ServiceInfo};
fn get_hostname() -> String {
    #[cfg(unix)]
    {
        use std::process::Command;
        Command::new("hostname")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "grbl-host".to_string())
    }
    #[cfg(not(unix))]
    {
        "grbl-host".to_string()
    }
}

pub fn register_service(port: u16, machine_name: &str) -> Result<ServiceDaemon, String> {
    let mdns = ServiceDaemon::new().map_err(|e| format!("Error iniciando mDNS: {}", e))?;

    let service_type = "_grbl-control._tcp.local.";
    let host_name = get_hostname();
    let host_fqdn = format!("{}.local.", host_name);

    let service = ServiceInfo::new(
        service_type,
        machine_name,
        &host_fqdn,
        "",
        port,
        None,
    )
    .map_err(|e| format!("Error creando servicio mDNS: {}", e))?;

    mdns.register(service)
        .map_err(|e| format!("Error registrando mDNS: {}", e))?;

    println!(
        "mDNS: servicio '{}' registrado en {}:{}",
        machine_name, host_fqdn, port
    );

    Ok(mdns)
}
