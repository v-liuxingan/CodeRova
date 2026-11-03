on run argv
    try
        if (count of argv) is 0 then
            set selectedPath to choose folder with prompt "选择本地文件夹"
        else
            set projectFolder to POSIX file (item 1 of argv) as alias
            set selectedPath to choose file with prompt "选择项目内源文件" of type {"rs", "java"} default location projectFolder
        end if
        return POSIX path of selectedPath
    on error messageText number errorNumber
        if errorNumber is -128 then return ""
        error messageText number errorNumber
    end try
end run
