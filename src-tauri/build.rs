fn main() {
    tauri_build::build();

    // tauri-build 只为 bin 嵌入完整 manifest；测试二进制没有 manifest 时，
    // comctl32 v6 专属符号（TaskDialogIndirect，来自托盘/菜单依赖链）会在
    // 加载期报 STATUS_ENTRYPOINT_NOT_FOUND。这里为测试目标单独嵌入一份
    // 声明 Common-Controls v6 的最小清单，与 bin 互不冲突。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_resource::compile_for_tests("tests.manifest.rc", embed_resource::NONE)
            .manifest_required()
            .expect("compile tests manifest");
    }
}
